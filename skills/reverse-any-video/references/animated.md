# Animated and painted films

In a hand-painted or 3D-animated film the character, the world and the camera are one picture, so the layers do not come apart. Most of the result is regenerated footage, with the type, the marks and the light effects in code.

Say so before starting, in the person's language. For example:

> This film is painted, so most of it will be regenerated from its own frames, shot by shot. The text, logo and light effects stay editable. The painted shots come back as clips you can replace, not layers you can change.

## What is code and what is generated

- **Code:** text and handwriting, logos, the end card, and light that sits on the picture: flashes, glows, a portal's ring.
- **Generated:** everything else, one clip per shot. A drawn character goes with its shot.

## The recipe

Work as `people.md` does, one generated shot per original shot, with these changes:

1. **Read the cuts by eye.** Sudden light in a shot can list as a cut. Look at the frames either side of each one: the same picture under different light is one shot. Join its pieces into one guide and pass `--allow-cuts`.
2. **The plate is the shot's first frame** with its text and logos removed by an image edit.
3. **Generate from the plate, with the shot as the guide:**

   ```bash
   npx hyperframes media-use generate --type video --reference <plate> --motion <the original shot> \
     --aspect <the source's> --seconds <n> --prompt "<the painting style, what moves, the camera>" --out <shot>.mp4
   ```

   `--first-frame` does not combine with `--motion`, so the plate goes in `--reference`. Name the style in the prompt, and blank drawn text in the guide with `--mask`.

4. **Frame it** with `npx hyperframes diff <video> . --at t,t,…` on a shape in the shot. `measure face` is for real faces.

`REVERSE.md` lists which shots are generated and which layers are code.
