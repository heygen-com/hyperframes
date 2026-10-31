# Re-shooting a person

Every person on screen, speaking or not, is re-shot with HeyGen so the original's face and the text burned over it never ship. What makes a re-shot person match is the original's own clip driving the motion, and one generated shot per original shot. The HyperFrames sign-in is enough; no API key is needed. Only when the person says not to use HeyGen, cut them on their own box instead and say the burned-in text came along.

## The recipe

1. **One shot per original shot.** From `measure cuts`: a generated shot never spans a cut, jump cuts and punch-ins included. One take across a jump cut deletes the cut; a motion guide that crosses a cut makes HeyGen cut somewhere of its own. HeyGen makes 5–15 s: a shorter shot is asked for at 5 s and trimmed; a longer one is split where the original reframes, else chained: the next part's reference is the last frame of the one before.
2. **A plate per shot:** a real frame of that shot at the source's aspect, with every drawn thing and every other face (a photo on the wall, a sticker) painted out, since HeyGen may animate the wrong face (`cv2.inpaint` for small marks, a temporal median where the person moves); it keeps the room sharp and true. Where drawn things are large or cross the person, an image edit cleans better (`npx hyperframes media-use generate --type image --reference <frame>`, asked to remove the text and keep everything else); check it kept the room sharp.
3. **Generate every shot at once,** in the background, and build the graphics while they render (each comes back in about a minute):

   ```bash
   npx hyperframes media-use generate --type video --reference <plate> --motion <the original shot> \
     --mask <x,y,w,h,a-b> --audio <the original voice over that shot> --aspect <the source's> --seconds <n> \
     --prompt "<who, where, what they do, the camera>" --out <shot>.mp4
   ```

   `--motion` is the original shot itself, cut at its cut times: HeyGen follows its body and camera motion and takes the face from the plate. It also copies text burned into the guide, so give one `--mask` per drawn box in that shot (the clip's pixels and seconds). Mask the text's own box, never a full-width band: a gesture under a mask is lost. A person who does not speak gets no `--audio`.

   A credit limit the person named: price every shot first with `--plan`, keep the people that fit, pass what is left as `--max-credits`, and ask before cutting a person to stay under it.

4. **Check each shot as it arrives:** no cut inside it (generate prints `cuts_inside`, and refuses a guide with a cut), none of the original's text, the face box within 5% of the original's (`npx hyperframes measure face`). Regenerate a failing shot once; then trim it to its good part. A shot HeyGen refuses or fails (`generation_failed`) gets one more try, test calls included, in this session or a resumed one; then stop and ask the person whether to keep the original's footage for now or drop the shot.
5. **Frame it:** scale and move each shot so its face box sits on the original's at the shot's start and end (`npx hyperframes measure face <shot> --against <video> --from a --to b` prints the `scale`, `x`, `y` to set), tweening between them only where the original's camera moves. The framing jumps at cuts and nowhere else.
6. **Text behind the person:** where the original's text passes behind them, cut them out of the shot (`npx hyperframes remove-background <shot> -o <cutout>.webm`) and stack shot, text, cutout.

Keep the original's voice as the soundtrack and the shots muted. Do not clone voices or make avatars for a re-shoot: the original voice drives the lips. The people inside a photo, a collage or a screenshot are sub-assets, cut with it.
