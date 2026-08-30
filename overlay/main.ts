import { app, BrowserWindow, desktopCapturer, ipcMain, screen, shell, systemPreferences } from "electron";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const WINDOW_WIDTH = 440;
const WINDOW_HEIGHT = 176;

interface WindowPosition {
  x: number;
  y: number;
}

interface SavedRecording {
  durationSeconds: number;
  videoPath: string;
}

interface UploadedRecording {
  id: string;
}

function positionPath(): string {
  return path.join(app.getPath("userData"), "overlay-window-position.json");
}

async function loadPosition(): Promise<WindowPosition | undefined> {
  try {
    const savedPosition = await fs.readFile(positionPath(), "utf8");
    const parsedPosition: unknown = JSON.parse(savedPosition);

    if (
      typeof parsedPosition === "object" &&
      parsedPosition !== null &&
      "x" in parsedPosition &&
      "y" in parsedPosition &&
      typeof parsedPosition.x === "number" &&
      typeof parsedPosition.y === "number"
    ) {
      return { x: parsedPosition.x, y: parsedPosition.y };
    }
  } catch (error: unknown) {
    const errorCode =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
    if (errorCode !== "ENOENT") {
      console.error("Could not restore the overlay position.", error);
    }
  }

  return undefined;
}

async function savePosition(window: BrowserWindow): Promise<void> {
  const [x, y] = window.getPosition();
  try {
    await fs.writeFile(positionPath(), JSON.stringify({ x, y }), "utf8");
  } catch (error: unknown) {
    console.error("Could not save the overlay position.", error);
  }
}

async function primaryDisplaySourceId(): Promise<string> {
  const primaryDisplayId = screen.getPrimaryDisplay().id.toString();
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 0, height: 0 }
  });
  const primarySource = sources.find((source) => source.display_id === primaryDisplayId);

  if (primarySource === undefined) {
    throw new Error("The primary display is not available for recording.");
  }

  return primarySource.id;
}

async function recordingDirectory(): Promise<string> {
  const directory = path.join(app.getPath("userData"), "recordings");
  await fs.mkdir(directory, { recursive: true });
  return directory;
}

async function remuxToMp4(webmPath: string, mp4Path: string): Promise<void> {
  if (ffmpegPath === null) {
    throw new Error("The bundled video converter is unavailable.");
  }
  const executablePath: string = ffmpegPath;

  await new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn(executablePath, [
      "-y",
      "-i",
      webmPath,
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      mp4Path
    ]);
    let errorOutput = "";

    ffmpeg.stderr.on("data", (chunk: Buffer) => {
      errorOutput += chunk.toString();
    });
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (exitCode: number | null) => {
      if (exitCode === 0) {
        resolve();
        return;
      }
      reject(new Error(`Video conversion failed: ${errorOutput.trim()}`));
    });
  });
}

async function saveRecording(webmData: ArrayBuffer, durationSeconds: number): Promise<SavedRecording> {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("The recording duration must be greater than zero.");
  }

  const directory = await recordingDirectory();
  const recordingId = randomUUID();
  const webmPath = path.join(directory, `${recordingId}.webm`);
  const mp4Path = path.join(directory, `${recordingId}.mp4`);

  await fs.writeFile(webmPath, Buffer.from(webmData));
  try {
    await remuxToMp4(webmPath, mp4Path);
    await fs.unlink(webmPath);
  } catch (error: unknown) {
    throw new Error(
      `The original WebM recording was kept at ${webmPath}. ${
        error instanceof Error ? error.message : "The MP4 conversion failed."
      }`
    );
  }

  return { durationSeconds, videoPath: mp4Path };
}

function screenRecordingPermissionStatus(): string {
  return systemPreferences.getMediaAccessStatus("screen");
}

async function openScreenRecordingSettings(): Promise<void> {
  await shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture");
}

async function uploadRecording(
  videoPath: string,
  taskName: string,
  durationSeconds: number
): Promise<UploadedRecording> {
  if (taskName.trim().length === 0 || taskName.length > 200) {
    throw new Error("A task name between 1 and 200 characters is required.");
  }

  const videoData = await fs.readFile(videoPath);
  const formData = new FormData();
  formData.append("video", new Blob([videoData], { type: "video/mp4" }), path.basename(videoPath));
  formData.append("task_name", taskName.trim());
  formData.append("duration_seconds", durationSeconds.toString());

  let response: Response;
  try {
    response = await fetch("http://127.0.0.1:8000/recordings", {
      method: "POST",
      body: formData
    });
  } catch {
    throw new Error("Owari could not reach the local server. Your recording is saved; retry when it is running.");
  }

  if (!response.ok) {
    throw new Error("Owari could not upload the recording. Your recording is saved; retry in a moment.");
  }

  const payload: unknown = await response.json();
  if (typeof payload !== "object" || payload === null || !("id" in payload) || typeof payload.id !== "string") {
    throw new Error("The local server returned an invalid upload response. Your recording is saved; retry later.");
  }

  return { id: payload.id };
}

ipcMain.handle("capture:primary-display-source", primaryDisplaySourceId);
ipcMain.handle("recording:save", (_event, webmData: ArrayBuffer, durationSeconds: number) =>
  saveRecording(webmData, durationSeconds)
);
ipcMain.handle("permission:screen-recording-status", screenRecordingPermissionStatus);
ipcMain.handle("permission:open-screen-recording-settings", openScreenRecordingSettings);
ipcMain.handle(
  "recording:upload",
  (_event, videoPath: string, taskName: string, durationSeconds: number) =>
    uploadRecording(videoPath, taskName, durationSeconds)
);

async function createOverlayWindow(): Promise<BrowserWindow> {
  const savedPosition = await loadPosition();
  const overlayWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x: savedPosition?.x,
    y: savedPosition?.y,
    frame: false,
    transparent: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    type: "panel",
    title: "Owari recorder",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.on("moved", () => {
    void savePosition(overlayWindow);
  });
  overlayWindow.on("closed", () => {
    void savePosition(overlayWindow);
  });

  await overlayWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  return overlayWindow;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [overlayWindow] = BrowserWindow.getAllWindows();
    if (overlayWindow !== undefined) {
      overlayWindow.showInactive();
      overlayWindow.moveTop();
    }
  });

  app.whenReady().then(async () => {
    await createOverlayWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createOverlayWindow().catch((error: unknown) => {
          console.error("Could not recreate the overlay window.", error);
        });
      }
    });
  }).catch((error: unknown) => {
    console.error("Owari overlay could not start.", error);
    app.quit();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
