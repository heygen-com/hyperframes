const WINDOW_SIZE = 1024;
const HOP_SIZE = 512;

// fallow-ignore-next-line complexity
export async function detectBeats(audioBuffer: AudioBuffer): Promise<number[]> {
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;

  const energies: number[] = [];
  for (let i = 0; i < channelData.length - WINDOW_SIZE; i += HOP_SIZE) {
    let sum = 0;
    for (let j = 0; j < WINDOW_SIZE; j++) {
      const sample = channelData[i + j]!;
      sum += sample * sample;
    }
    energies.push(sum / WINDOW_SIZE);
  }

  const beats: number[] = [];
  const localWindowSize = 20;

  for (let i = localWindowSize; i < energies.length - localWindowSize; i++) {
    let localMean = 0;
    for (let j = i - localWindowSize; j < i + localWindowSize; j++) {
      localMean += energies[j]!;
    }
    localMean /= localWindowSize * 2;

    const threshold = localMean * 1.5;
    const current = energies[i]!;

    if (
      current > threshold &&
      current > (energies[i - 1] ?? 0) &&
      current > (energies[i + 1] ?? 0)
    ) {
      const timeInSeconds = (i * HOP_SIZE) / sampleRate;
      if (beats.length === 0 || timeInSeconds - beats[beats.length - 1]! > 0.1) {
        beats.push(Math.round(timeInSeconds * 1000) / 1000);
      }
    }
  }

  return beats;
}

// fallow-ignore-next-line complexity
export async function detectBeatsFromUrl(url: string): Promise<number[]> {
  const audioContext = new AudioContext();
  try {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    return detectBeats(audioBuffer);
  } finally {
    await audioContext.close();
  }
}
