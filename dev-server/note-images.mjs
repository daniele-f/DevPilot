import { randomUUID } from 'node:crypto';
import { fail, text } from './workspace.mjs';

export function prepareNoteImages(images = []) {
  if (!Array.isArray(images) || images.length > 3) fail(400, 'Use up to three images per note.');
  return images.map(image => {
    if (!image || typeof image.data_base64 !== 'string' || image.data_base64.length > 6990508 ||
        image.data_base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data_base64))
      fail(400, 'Provide a base64 image of up to 5 MB.');
    const data = Buffer.from(image.data_base64, 'base64');
    if (data.toString('base64') !== image.data_base64) fail(400, 'Provide a valid base64 image.');
    const valid = image.mime_type === 'image/png' ? data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      : image.mime_type === 'image/jpeg' ? data.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
      : image.mime_type === 'image/webp' && data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP';
    if (!valid || data.length > 5242880) fail(400, 'Use a PNG, JPEG or WebP image of up to 5 MB.');
    const name = text(image.name, 100).replace(/[\[\]\r\n]/g, ' ');
    return { id: randomUUID(), name, mime_type: image.mime_type, data };
  });
}
