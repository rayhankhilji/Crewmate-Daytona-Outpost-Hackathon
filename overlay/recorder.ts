interface SavedRecording {
  durationSeconds: number;
  videoPath: string;
}

interface CrewmateOverlayApi {
  getPrimaryDisplaySource(): Promise<string>;
  getScreenRecordingPermissionStatus(): Promise<string>;
  openScreenRecordingSettings(): Promise<void>;
  saveRecording(webmData: ArrayBuffer, durationSeconds: number): Promise<SavedRecording>;
  uploadRecording(videoPath: string, taskName: string, durationSeconds: number): Promise<{ id: string }>;
}

interface Window {
  crewmateOverlay: CrewmateOverlayApi;
}

interface DesktopCaptureMandatoryConstraints {
  chromeMediaSource: "desktop";
  chromeMediaSourceId: string;
  maxFrameRate: number;
  maxHeight: number;
  maxWidth: number;
}

interface DesktopCaptureConstraints {
  mandatory: DesktopCaptureMandatoryConstraints;
}

function formatElapsedTime(elapsedMilliseconds: number): string {
  const elapsedSeconds = Math.floor(elapsedMilliseconds / 1000);
  const minutes = Math.floor(elapsedSeconds / 60).toString().padStart(2, "0");
  const seconds = (elapsedSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

class ScreenRecorder {
  private mediaRecorder: MediaRecorder | undefined;
  private mediaStream: MediaStream | undefined;
  private readonly chunks: Blob[] = [];
  private startedAt: number | undefined;
  private timerId: number | undefined;

  public constructor(private readonly onTimer: (formattedTime: string) => void) {}

  public get isRecording(): boolean {
    return this.mediaRecorder?.state === "recording";
  }

  public async start(): Promise<void> {
    if (this.isRecording) {
      throw new Error("A recording is already in progress.");
    }

    const permissionStatus = await window.crewmateOverlay.getScreenRecordingPermissionStatus();
    if (permissionStatus === "denied" || permissionStatus === "restricted") {
      throw new ScreenRecordingPermissionError();
    }

    const sourceId = await window.crewmateOverlay.getPrimaryDisplaySource();
    const desktopConstraints: DesktopCaptureConstraints = {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: sourceId,
        maxFrameRate: 15,
        maxHeight: 800,
        maxWidth: 1280
      }
    };

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: desktopConstraints as unknown as MediaTrackConstraints
      });
    } catch (error: unknown) {
      if (isScreenRecordingPermissionError(error)) {
        throw new ScreenRecordingPermissionError();
      }
      throw error;
    }
    this.chunks.length = 0;
    if (!MediaRecorder.isTypeSupported("video/webm;codecs=vp9")) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = undefined;
      throw new Error("This Mac cannot encode the required screen-recording video format.");
    }
    this.mediaRecorder = new MediaRecorder(this.mediaStream, {
      mimeType: "video/webm;codecs=vp9"
    });
    this.mediaRecorder.addEventListener("dataavailable", (event: BlobEvent) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    });
    this.mediaRecorder.start(1000);
    this.startedAt = performance.now();
    this.startTimer();
  }

  public async stop(): Promise<SavedRecording> {
    if (this.mediaRecorder === undefined || this.mediaStream === undefined || this.startedAt === undefined) {
      throw new Error("There is no recording to stop.");
    }

    const recorder = this.mediaRecorder;
    const stream = this.mediaStream;
    const durationSeconds = (performance.now() - this.startedAt) / 1000;

    await new Promise<void>((resolve, reject) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
      recorder.addEventListener("error", () => reject(new Error("Screen recording stopped unexpectedly.")), {
        once: true
      });
      recorder.stop();
    });

    this.stopTimer();
    stream.getTracks().forEach((track) => track.stop());
    this.mediaRecorder = undefined;
    this.mediaStream = undefined;
    this.startedAt = undefined;
    this.onTimer("00:00");

    const webmData = await new Blob(this.chunks, { type: "video/webm" }).arrayBuffer();
    return window.crewmateOverlay.saveRecording(webmData, durationSeconds);
  }

  private startTimer(): void {
    this.stopTimer();
    this.timerId = window.setInterval(() => {
      if (this.startedAt !== undefined) {
        this.onTimer(formatElapsedTime(performance.now() - this.startedAt));
      }
    }, 250);
  }

  private stopTimer(): void {
    if (this.timerId !== undefined) {
      window.clearInterval(this.timerId);
      this.timerId = undefined;
    }
  }
}

function isScreenRecordingPermissionError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "NotAllowedError" || error.name === "SecurityError")
  );
}

class ScreenRecordingPermissionError extends Error {
  public constructor() {
    super("Screen Recording permission is required. Enable it in System Settings, then try again.");
    this.name = "ScreenRecordingPermissionError";
  }
}
