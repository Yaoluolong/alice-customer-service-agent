import { execFile } from "child_process";
import { readFile, unlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { randomBytes } from "crypto";

const execFileAsync = promisify(execFile);

/**
 * Extract the first frame from a video buffer and return it as a JPEG base64 string.
 * Requires ffmpeg to be installed on the system (available in the Docker image).
 *
 * @throws if ffmpeg is not available or the video cannot be processed
 */
export async function extractFirstFrame(videoBuffer: Buffer): Promise<string> {
  const id = randomBytes(8).toString("hex");
  const inputPath = join(tmpdir(), `ov-video-${id}.tmp`);
  const outputPath = join(tmpdir(), `ov-frame-${id}.jpg`);

  await writeFile(inputPath, videoBuffer);

  try {
    await execFileAsync(
      "ffmpeg",
      ["-i", inputPath, "-frames:v", "1", "-q:v", "2", "-y", outputPath],
      { timeout: 10_000 }
    );

    const frameBuffer = await readFile(outputPath);
    return frameBuffer.toString("base64");
  } finally {
    await Promise.all([
      unlink(inputPath).catch(() => {}),
      unlink(outputPath).catch(() => {})
    ]);
  }
}
