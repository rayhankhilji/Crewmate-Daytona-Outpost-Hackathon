function requiredElement<ElementType extends Element>(selector: string): ElementType {
  const element = document.querySelector<ElementType>(selector);
  if (element === null) {
    throw new Error(`The recorder control ${selector} could not be loaded.`);
  }
  return element;
}

const recordButton = requiredElement<HTMLButtonElement>("#record-button");
const taskNameInput = requiredElement<HTMLInputElement>("#task-name");
const timer = requiredElement<HTMLOutputElement>("#recording-timer");
const recordButtonLabel = requiredElement<HTMLSpanElement>("#record-button-label");
const statusMessage = requiredElement<HTMLParagraphElement>("#status-message");
const openSettingsButton = requiredElement<HTMLButtonElement>("#open-settings-button");

const recorder = new ScreenRecorder((formattedTime: string) => {
  timer.value = formattedTime;
  timer.textContent = formattedTime;
});
let pendingRecording: SavedRecording | undefined;

function setStatus(message: string, isError = false): void {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("is-error", isError);
}

function setRecordButton(label: string, accessibleLabel: string): void {
  recordButtonLabel.textContent = label;
  recordButton.setAttribute("aria-label", accessibleLabel);
}

async function uploadPendingRecording(): Promise<void> {
  if (pendingRecording === undefined) {
    throw new Error("There is no saved recording to upload.");
  }

  const upload = await window.crewmateOverlay.uploadRecording(
    pendingRecording.videoPath,
    taskNameInput.value,
    pendingRecording.durationSeconds
  );
  pendingRecording = undefined;
  setStatus(`Uploaded recording ${upload.id}.`);
  setRecordButton("Record", "Start recording");
}

openSettingsButton.addEventListener("click", async () => {
  try {
    await window.crewmateOverlay.openScreenRecordingSettings();
  } catch {
    setStatus("System Settings could not be opened. Enable Screen Recording permission manually.", true);
  }
});

recordButton.addEventListener("click", async () => {
  if (taskNameInput.value.trim().length === 0) {
    taskNameInput.focus();
    taskNameInput.setAttribute("aria-invalid", "true");
    setStatus("Name the workflow before recording.", true);
    return;
  }

  taskNameInput.removeAttribute("aria-invalid");
  recordButton.disabled = true;
  openSettingsButton.hidden = true;

  try {
    if (pendingRecording !== undefined) {
      setRecordButton("Retrying…", "Retrying the saved recording upload");
      await uploadPendingRecording();
    } else if (recorder.isRecording) {
      setRecordButton("Saving…", "Saving recording");
      pendingRecording = await recorder.stop();
      await uploadPendingRecording();
      document.body.classList.remove("is-recording");
    } else {
      setRecordButton("Starting…", "Starting recording");
      await recorder.start();
      setStatus("");
      setRecordButton("Stop", "Stop recording");
      document.body.classList.add("is-recording");
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "The recording could not be completed.";
    setStatus(message, true);
    if (error instanceof ScreenRecordingPermissionError) {
      openSettingsButton.hidden = false;
    }
    if (pendingRecording !== undefined) {
      setRecordButton("Retry upload", "Retry uploading the saved recording");
    } else {
      setRecordButton("Record", "Start recording");
    }
  } finally {
    recordButton.disabled = false;
  }
});
