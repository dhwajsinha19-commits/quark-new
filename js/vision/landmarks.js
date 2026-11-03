// Loads MediaPipe Tasks Vision (Face, Hand and Pose Landmarkers) from the local vendor/ folder. Everything
// runs in the browser: the wasm, the models and the video all stay on this device.
//
// Face and Hand load first (they drive every reaction); Pose loads afterwards in the background and is
// simply skipped if the device can't spare the memory.

const BASE = new URL('../../vendor/mediapipe/', import.meta.url).href;

let modPromise = null;
const loadModule = () => (modPromise ||= import(`${BASE}vision_bundle.mjs`));

async function create(Cls, fileset, model, opts) {
  let last;
  for (const delegate of ['GPU', 'CPU']) {          // GPU is faster and cooler; CPU is the safety net
    try {
      const inst = await Cls.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${BASE}models/${model}`, delegate },
        runningMode: 'VIDEO',
        ...opts,
      });
      return { inst, delegate };
    } catch (e) { last = e; }
  }
  throw last;
}

/**
 * Resolves { face, hands, pose|null, delegate, loadPose() }. Rejects if the core (face+hands) can't load,
 * in which case the caller falls back to plain motion sensing.
 */
export async function loadLandmarkers() {
  const { FilesetResolver, FaceLandmarker, HandLandmarker, PoseLandmarker } = await loadModule();
  const fileset = await FilesetResolver.forVisionTasks(`${BASE}wasm`);
  const f = await create(FaceLandmarker, fileset, 'face_landmarker.task', { numFaces: 1, outputFaceBlendshapes: false, minFaceDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
  const h = await create(HandLandmarker, fileset, 'hand_landmarker.task', { numHands: 2, minHandDetectionConfidence: 0.55, minTrackingConfidence: 0.5 });
  const api = {
    face: f.inst,
    hands: h.inst,
    pose: null,
    delegate: f.delegate,
    async loadPose() {
      try {
        const p = await create(PoseLandmarker, fileset, 'pose_landmarker.task', { numPoses: 1 });
        api.pose = p.inst;
      } catch { api.pose = null; }
      return api.pose;
    },
    close() {
      for (const k of ['face', 'hands', 'pose']) { try { api[k]?.close(); } catch { /* ignore */ } api[k] = null; }
    },
  };
  return api;
}
