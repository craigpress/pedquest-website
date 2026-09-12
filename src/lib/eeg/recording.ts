// What the viewer needs from any recording, whatever container it came in.
// EdfReader (./edf) and LayReader (./lay) both satisfy this.

import type { EdfAnnotation, SignalWindow } from "./edf";

export interface RecordingInfo {
  /** "EDF+" | "Persyst .lay/.dat" */
  format: string;
  startDateTime: Date | null;
  patient: string;
  /** free text: header notes worth showing (recording field, [Patient] comments) */
  notes: string[];
}

export interface Recording {
  readonly durationS: number;
  readonly sampleRate: number;
  readonly labels: string[];
  readonly info: RecordingInfo;
  readWindow(t0: number, t1: number): Promise<SignalWindow>;
  /** every annotation in the recording; may read the whole file for EDF */
  scanAnnotations(onProgress?: (frac: number) => void, signal?: AbortSignal): Promise<EdfAnnotation[]>;
  /** true when scanAnnotations is free (annotations live in a header, not the records) */
  readonly annotationsUpFront: boolean;
}
