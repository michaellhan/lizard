// A picked, dropped or pasted image to pixels, in this browser (nothing is uploaded). A picture wider than MAX_W is
// halved until it isn't: the reader works on cards some tens of pixels tall, and a 4K screenshot only costs time.
import { halve, type Img } from "./image";

export const MAX_W = 2400;

/** The file's pixels, or null where the browser can't decode it as an image. */
export async function decodeImage(file: Blob): Promise<Img | null> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    return null;
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx || !bmp.width || !bmp.height) return null;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height);
    let img: Img = { width: d.width, height: d.height, data: d.data };
    while (img.width > MAX_W) img = halve(img);
    return img;
  } finally {
    bmp.close();
  }
}
