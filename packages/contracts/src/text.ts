import {z} from 'zod';
// Free text is stored and later rendered in staff screens. React escapes HTML, so these rules do not replace output
// encoding; they remove characters that have no place in names/addresses and can spoof or break display
// (C0/C1 control characters, line/paragraph separators, BOM, zero-width space, word joiner and bidirectional
// override/isolate marks). ZWNJ/ZWJ are intentionally allowed because Indic scripts and emoji sequences need them.
// Patterns are built from escaped code points so no invisible character is stored in this source file.
const hidden='\\u2028\\u2029\\u202A-\\u202E\\u2060\\u2066-\\u2069\\u200B\\uFEFF';
const singleLine=new RegExp('^[^\\u0000-\\u001F\\u007F-\\u009F'+hidden+']*$','u');
const multiLine=new RegExp('^[^\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F'+hidden+']*$','u');
const message='Remove control or hidden formatting characters.';
export const plainText=(schema:z.ZodString)=>schema.refine(value=>singleLine.test(value),message);
export const plainNote=(schema:z.ZodString)=>schema.refine(value=>multiLine.test(value),message);
