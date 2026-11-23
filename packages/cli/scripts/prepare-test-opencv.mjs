// Fetches opencv.js and the face models into this machine's cache, verified against opencv.ts's pins, so the
// tests copy them from there and none downloads anything.
import { loadOpenCv, OPENCV_DIR } from "../src/measure/opencv.ts";

await loadOpenCv((message) => console.log(message));
console.log(`opencv.js ready in ${OPENCV_DIR}`);
