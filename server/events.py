"""In-memory SSE broadcaster: one channel per id, many subscribers per channel.

Backs both `/recordings/{id}/events` and `/runs/{id}/events`. Events are ephemeral — the
database is the source of truth, and a client that missed an event recovers by re-reading
`GET /runs/{id}`. Publishing to a channel with no subscribers is a no-op, because a run
starts producing events before the dashboard has connected.

`publish` and `close` are plain synchronous functions and are safe to call from any thread.
The executor runs each worker on a background thread (the Daytona SDK is synchronous), so
every event this broadcaster carries during a run arrives from off the event loop.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger("owari.server.events")

# Bounded so one stalled reader cannot grow without limit — worker events carry base64
# screenshots. On overflow the oldest event is dropped: this is a live status feed, the
# newest state is the useful one, and step history is durable in step_results regardless.
QUEUE_MAXSIZE = 256

SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


@dataclass(frozen=True)
class Event:
    """One SSE message. `type` becomes the event name, `data` is serialised as JSON."""

    type: str
    data: dict[str, Any]

    def encode(self) -> str:
        return f"event: {self.type}\ndata: {json.dumps(self.data)}\n\n"


@dataclass(eq=False)
class _Subscriber:
    """One connected client. Holds the loop it subscribed on so publishers can be threads."""

    queue: asyncio.Queue[Event | None]
    loop: asyncio.AbstractEventLoop
    dropped: int = field(default=0)


class EventBroadcaster:
    """Fan-out of events to every subscriber of a channel."""

    def __init__(self) -> None:
        self._channels: dict[str, set[_Subscriber]] = {}

    def subscriber_count(self, channel_id: str) -> int:
        return len(self._channels.get(channel_id, ()))

    def _deliver(self, subscriber: _Subscriber, item: Event | None) -> None:
        """Enqueue on the subscriber's own loop. Safe from the loop thread or any other."""
        subscriber.loop.call_soon_threadsafe(self._enqueue, subscriber, item)

    @staticmethod
    def _enqueue(subscriber: _Subscriber, item: Event | None) -> None:
        if subscriber.queue.full():
            subscriber.queue.get_nowait()
            subscriber.dropped += 1
            if subscriber.dropped == 1:
                # Warn once. The running tally is reported when the subscriber disconnects,
                # so a slow client cannot flood the log with a line per dropped event.
                logger.warning(
                    "SSE subscriber is not keeping up; dropping oldest events"
                )
        subscriber.queue.put_nowait(item)

    def publish(self, channel_id: str, event_type: str, data: dict[str, Any]) -> None:
        """Send an event to every subscriber of a channel. Safe to call from any thread."""
        event = Event(type=event_type, data=data)
        for subscriber in tuple(self._channels.get(channel_id, ())):
            self._deliver(subscriber, event)

    def close(self, channel_id: str) -> None:
        """End every stream on a channel. Called after a terminal event has been published."""
        for subscriber in tuple(self._channels.get(channel_id, ())):
            self._deliver(subscriber, None)

    @asynccontextmanager
    async def subscribe(self, channel_id: str) -> AsyncIterator[AsyncIterator[Event]]:
        """Subscribe for the duration of the block, unsubscribing however the block exits.

        The finally clause is what makes a client disconnect clean: Starlette cancels the
        response generator, and the subscriber is removed rather than accumulating.
        """
        subscriber = _Subscriber(
            queue=asyncio.Queue(maxsize=QUEUE_MAXSIZE),
            loop=asyncio.get_running_loop(),
        )
        self._channels.setdefault(channel_id, set()).add(subscriber)
        try:
            yield self._drain(subscriber)
        finally:
            channel = self._channels.get(channel_id)
            if channel is not None:
                channel.discard(subscriber)
                if not channel:
                    del self._channels[channel_id]
            if subscriber.dropped:
                logger.warning(
                    "SSE subscriber on channel %s disconnected having dropped %d events",
                    channel_id,
                    subscriber.dropped,
                )

    @staticmethod
    async def _drain(subscriber: _Subscriber) -> AsyncIterator[Event]:
        """Yield events until the channel is closed."""
        while True:
            item = await subscriber.queue.get()
            if item is None:
                return
            yield item


broadcaster = EventBroadcaster()


async def channel_stream(channel_id: str) -> AsyncIterator[str]:
    """Encoded SSE frames for a channel, ending when the channel is closed."""
    async with broadcaster.subscribe(channel_id) as stream:
        async for event in stream:
            yield event.encode()
