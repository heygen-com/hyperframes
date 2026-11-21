// fallow-ignore-file unused-file
import { getMediaDurationSeconds } from "./transcribe.js";

process.stdout.write(String(getMediaDurationSeconds(process.argv[2] ?? "")));
