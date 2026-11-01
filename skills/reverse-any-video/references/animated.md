# Animated and painted films

In a hand-painted or 3D-animated film the character, the world and the camera are one picture, so the layers do not come apart. Decide shot by shot: build what code can carry, and generate the rest.

Say so before starting, in the person's language. For example:

> This film is painted, so I'll rebuild what I can in code and regenerate the rest from its own frames, shot by shot. The code parts stay editable. The generated shots come back as clips you can replace, not layers you can change.

## What is code and what is generated

- **Code:** text and handwriting, logos, the end card, light that sits on the picture (flashes, glows, a portal's ring), and a camera moving over a still world: measure the camera and build layers from clean plates.
- **Generated:** a character acting, a picture that morphs, and fine flowing detail such as streamlines, which code draws in the wrong shape.
- **Both:** in a mixed shot, generate the acting and lay the code over it.

## The recipe for a generated shot

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
