"""The single error envelope for every route. See API.md, 'Conventions'."""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("owari.server")


class ApiError(Exception):
    """An error with a client-safe code and message. Raise this from any route."""

    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def error_response(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": message}},
    )


async def _handle_api_error(request: Request, exc: ApiError) -> JSONResponse:
    logger.info(
        "%s %s -> %s %s", request.method, request.url.path, exc.status_code, exc.code
    )
    return error_response(exc.status_code, exc.code, exc.message)


async def _handle_http_exception(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    return error_response(exc.status_code, "http_error", str(exc.detail))


async def _handle_request_validation(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    first = exc.errors()[0]
    location = ".".join(str(part) for part in first["loc"][1:]) or first["loc"][0]
    return error_response(400, "invalid_request", f"{location}: {first['msg']}")


async def _handle_unexpected(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return error_response(
        500, "internal_error", "The server failed to handle the request."
    )


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ApiError, _handle_api_error)  # type: ignore[arg-type]
    app.add_exception_handler(StarletteHTTPException, _handle_http_exception)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, _handle_request_validation)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, _handle_unexpected)
