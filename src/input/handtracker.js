import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

/**
 * Webcam → MediaPipe Hands → 21 landmarks.
 *
 * Runs the GPU delegate with a single-hand model. One hand, deliberately: the
 * brief's gun is a one-handed pose, and letting a second hand into the stream
 * means the recogniser has to decide which one is the gun, which it will
 * eventually get wrong at the worst moment.
 *
 * The detector is polled off the video's own frame clock rather than the
 * render loop, because MediaPipe rejects a repeated timestamp and a 120 Hz
 * render loop against a 30 Hz camera would spend most of its calls being
 * rejected.
 */
export class HandTracker {
  constructor() {
    this.landmarker = null;
    this.video = null;
    this.landmarks = null;
    this.lastVideoTime = -1;
    this.ready = false;
    this.error = null;
    this.handedness = null;
  }

  async init(videoEl, { wasmBase, modelUrl } = {}) {
    this.video = videoEl;
    try {
      const fileset = await FilesetResolver.forVisionTasks(
        wasmBase ?? 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm');
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: modelUrl ??
            'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.55,
        minTrackingConfidence: 0.55,
      });

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' }, audio: false,
      });
      videoEl.srcObject = stream;
      await videoEl.play();
      this.ready = true;
    } catch (e) {
      this.error = e;
      this.ready = false;
      throw e;
    }
  }

  /** Poll. Returns the freshest landmark array, or null. */
  poll() {
    if (!this.ready || !this.video || this.video.readyState < 2) return this.landmarks;
    if (this.video.currentTime === this.lastVideoTime) return this.landmarks;
    this.lastVideoTime = this.video.currentTime;

    const res = this.landmarker.detectForVideo(this.video, performance.now());
    if (res.landmarks && res.landmarks.length) {
      this.landmarks = res.landmarks[0];
      this.handedness = res.handednesses?.[0]?.[0]?.categoryName ?? null;
    } else {
      this.landmarks = null;
    }
    return this.landmarks;
  }

  /** Debug skeleton over the camera preview. Cheap, and worth it. */
  drawOverlay(canvas) {
    if (!canvas || !this.video) return;
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    const lm = this.landmarks;
    if (!lm) return;

    const BONES = [
      [0,1],[1,2],[2,3],[3,4],
      [0,5],[5,6],[6,7],[7,8],
      [0,9],[9,10],[10,11],[11,12],
      [0,13],[13,14],[14,15],[15,16],
      [0,17],[17,18],[18,19],[19,20],
      [5,9],[9,13],[13,17],
    ];
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,194,74,.75)';
    for (const [a, b] of BONES) {
      ctx.beginPath();
      ctx.moveTo(lm[a].x * w, lm[a].y * h);
      ctx.lineTo(lm[b].x * w, lm[b].y * h);
      ctx.stroke();
    }
    // The barrel, highlighted: index MCP to tip.
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = '#FF4438';
    ctx.beginPath();
    ctx.moveTo(lm[5].x * w, lm[5].y * h);
    ctx.lineTo(lm[8].x * w, lm[8].y * h);
    ctx.stroke();
    // The trigger finger.
    ctx.strokeStyle = '#5EC8E5';
    ctx.beginPath();
    ctx.moveTo(lm[9].x * w, lm[9].y * h);
    ctx.lineTo(lm[12].x * w, lm[12].y * h);
    ctx.stroke();

    ctx.fillStyle = '#FFF6E4';
    for (const p of lm) {
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, 2.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  stop() {
    this.video?.srcObject?.getTracks?.().forEach((t) => t.stop());
    this.landmarker?.close?.();
    this.ready = false;
  }
}
