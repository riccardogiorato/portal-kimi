/**
 * audio/audioTestUtils.ts — Minimal WebAudio fakes for unit tests.
 *
 * These objects are enough to exercise the synthesis graph and scheduling
 * logic without requiring a real AudioContext or DOM implementation.
 */

export function makeFakeAudioParam(): AudioParam {
  const p = {
    value: 0,
    defaultValue: 0,
    minValue: -3.4028235e38,
    maxValue: 3.4028235e38,
    setValueAtTime(v: number) {
      p.value = v;
      return p as unknown as AudioParam;
    },
    linearRampToValueAtTime(v: number) {
      p.value = v;
      return p as unknown as AudioParam;
    },
    exponentialRampToValueAtTime(v: number) {
      p.value = v;
      return p as unknown as AudioParam;
    },
    setTargetAtTime(v: number) {
      p.value = v;
      return p as unknown as AudioParam;
    },
    cancelScheduledValues() { return p as unknown as AudioParam; },
  };
  return p as unknown as AudioParam;
}

class FakeAudioBuffer {
  readonly length: number;
  readonly duration: number;
  readonly sampleRate: number;
  readonly numberOfChannels = 1;
  private readonly data: Float32Array;

  constructor(length: number, sampleRate: number) {
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.data = new Float32Array(length);
  }

  getChannelData(_channel: number): Float32Array {
    return this.data;
  }

  copyFromChannel(): void {}
  copyToChannel(): void {}
}

function nodeBase(ctx: AudioContext) {
  return {
    context: ctx,
    disconnected: false,
    connectedTo: [] as unknown[],
    connect(this: unknown, target: unknown) {
      const self = this as { connectedTo: unknown[] };
      self.connectedTo.push(target);
      return self as unknown as AudioNode;
    },
    disconnect(this: unknown) {
      const self = this as { disconnected: boolean; connectedTo: unknown[] };
      self.disconnected = true;
      self.connectedTo = [];
    },
  };
}

function makeGain(ctx: AudioContext): GainNode {
  return { ...nodeBase(ctx), gain: makeFakeAudioParam() } as unknown as GainNode;
}

function makeOscillator(ctx: AudioContext): OscillatorNode {
  return {
    ...nodeBase(ctx),
    type: 'sine' as OscillatorType,
    frequency: makeFakeAudioParam(),
    detune: makeFakeAudioParam(),
    start: () => {},
    stop: () => {},
  } as unknown as OscillatorNode;
}

function makeBufferSource(ctx: AudioContext): AudioBufferSourceNode {
  return {
    ...nodeBase(ctx),
    buffer: null as AudioBuffer | null,
    loop: false,
    start: () => {},
    stop: () => {},
  } as unknown as AudioBufferSourceNode;
}

function makePanner(ctx: AudioContext): PannerNode {
  return {
    ...nodeBase(ctx),
    panningModel: 'equalpower',
    distanceModel: 'inverse',
    refDistance: 1,
    maxDistance: 10000,
    rolloffFactor: 1,
    positionX: makeFakeAudioParam(),
    positionY: makeFakeAudioParam(),
    positionZ: makeFakeAudioParam(),
    orientationX: makeFakeAudioParam(),
    orientationY: makeFakeAudioParam(),
    orientationZ: makeFakeAudioParam(),
  } as unknown as PannerNode;
}

function makeBiquad(ctx: AudioContext): BiquadFilterNode {
  return {
    ...nodeBase(ctx),
    type: 'lowpass' as BiquadFilterType,
    frequency: makeFakeAudioParam(),
    Q: makeFakeAudioParam(),
    gain: makeFakeAudioParam(),
    detune: makeFakeAudioParam(),
  } as unknown as BiquadFilterNode;
}

function makeCompressor(ctx: AudioContext): DynamicsCompressorNode {
  return {
    ...nodeBase(ctx),
    threshold: makeFakeAudioParam(),
    knee: makeFakeAudioParam(),
    ratio: makeFakeAudioParam(),
    attack: makeFakeAudioParam(),
    release: makeFakeAudioParam(),
  } as unknown as DynamicsCompressorNode;
}

function makeDestination(): AudioDestinationNode {
  return {
    ...nodeBase({} as AudioContext),
    maxChannelCount: 2,
    channelCount: 2,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
    numberOfInputs: 1,
    numberOfOutputs: 0,
  } as unknown as AudioDestinationNode;
}

function makeListener(): AudioListener {
  return {
    positionX: makeFakeAudioParam(),
    positionY: makeFakeAudioParam(),
    positionZ: makeFakeAudioParam(),
    forwardX: makeFakeAudioParam(),
    forwardY: makeFakeAudioParam(),
    forwardZ: makeFakeAudioParam(),
    upX: makeFakeAudioParam(),
    upY: makeFakeAudioParam(),
    upZ: makeFakeAudioParam(),
  } as unknown as AudioListener;
}

export function createFakeAudioContext(state: 'suspended' | 'running' | 'closed' = 'suspended'): AudioContext {
  let currentState = state;

  // The fake is built as a plain object and then cast; only the shapes used by
  // the audio system need to exist, which keeps the tests dependency-free.
  const ctx = {
    currentTime: 0,
    get state() { return currentState; },
    sampleRate: 48000,
    destination: makeDestination(),
    listener: makeListener(),
    createGain: () => makeGain(ctx as unknown as AudioContext),
    createOscillator: () => makeOscillator(ctx as unknown as AudioContext),
    createBuffer: (_channels: number, length: number, sampleRate: number) =>
      new FakeAudioBuffer(length, sampleRate) as unknown as AudioBuffer,
    createBufferSource: () => makeBufferSource(ctx as unknown as AudioContext),
    createPanner: () => makePanner(ctx as unknown as AudioContext),
    createBiquadFilter: () => makeBiquad(ctx as unknown as AudioContext),
    createDynamicsCompressor: () => makeCompressor(ctx as unknown as AudioContext),
    resume: async () => {
      currentState = 'running';
      return undefined;
    },
    close: async () => {
      currentState = 'closed';
      return undefined;
    },
  } as unknown as AudioContext;

  return ctx;
}

