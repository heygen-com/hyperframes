import { ensureAudioFxWorklets } from "./audioFxWorklets.js";

export interface Processor {
  port: { postMessage(data: unknown): void };
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}
export type ProcessorClass = new (o: unknown) => Processor;

/** The registered processors, evaluated from the module `addModule` is handed. */
export async function loadProcessors(sampleRate: number): Promise<Map<string, ProcessorClass>> {
  let moduleSource = "";
  await ensureAudioFxWorklets({
    audioWorklet: {
      addModule: async (url: string) => {
        moduleSource = atob(url.replace("data:text/javascript;base64,", ""));
      },
    },
  } as unknown as BaseAudioContext);
  const made = new Map<string, ProcessorClass>();
  class Base {
    port = {
      onmessage: null as ((e: { data: unknown }) => void) | null,
      postMessage: (data: unknown) => this.port.onmessage?.({ data }),
    };
  }
  new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", moduleSource)(
    Base,
    (name: string, cls: ProcessorClass) => made.set(name, cls),
    sampleRate,
  );
  return made;
}
