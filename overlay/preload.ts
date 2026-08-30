import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("crewmateOverlay", {
  getPrimaryDisplaySource: (): Promise<string> => ipcRenderer.invoke("capture:primary-display-source"),
  getScreenRecordingPermissionStatus: (): Promise<string> => ipcRenderer.invoke("permission:screen-recording-status"),
  openScreenRecordingSettings: (): Promise<void> => ipcRenderer.invoke("permission:open-screen-recording-settings"),
  saveRecording: (webmData: ArrayBuffer, durationSeconds: number): Promise<{ durationSeconds: number; videoPath: string }> =>
    ipcRenderer.invoke("recording:save", webmData, durationSeconds),
  uploadRecording: (
    videoPath: string,
    taskName: string,
    durationSeconds: number
  ): Promise<{ id: string }> => ipcRenderer.invoke("recording:upload", videoPath, taskName, durationSeconds),
  confirmComprehensionAndOpenDashboard: (recordingId: string): Promise<boolean> =>
    ipcRenderer.invoke("recording:confirm-comprehension-and-open-dashboard", recordingId)
});
