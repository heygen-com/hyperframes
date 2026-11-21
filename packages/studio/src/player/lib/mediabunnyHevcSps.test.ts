import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BufferSource,
  BufferTarget,
  EncodedPacket,
  EncodedVideoPacketSource,
  Input,
  MP4,
  Mp4OutputFormat,
  Output,
} from "mediabunny";

class Bits {
  private bits: number[] = [];
  u(value: number, width: number) {
    for (let i = width - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
    return this;
  }
  ue(value: number) {
    const width = Math.floor(Math.log2(value + 1));
    return this.u(0, width).u(value + 1, width + 1);
  }
  rbsp(): number[] {
    this.u(1, 1);
    while (this.bits.length % 8) this.bits.push(0);
    const bytes: number[] = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      bytes.push(this.bits.slice(i, i + 8).reduce((byte, bit) => (byte << 1) | bit, 0));
    }
    return bytes;
  }
}

function withEmulationPrevention(rbsp: number[]): number[] {
  const out: number[] = [];
  let zeros = 0;
  for (const byte of rbsp) {
    if (zeros >= 2 && byte <= 3) {
      out.push(3);
      zeros = 0;
    }
    out.push(byte);
    zeros = byte === 0 ? zeros + 1 : 0;
  }
  return out;
}

/** A 64x64 SPS with one long-term reference picture and 4:3 pixels, the shape phone HEVC carries. */
function spsWithLongTermRefs(): number[] {
  const b = new Bits()
    .u(0, 4) // sps_video_parameter_set_id
    .u(0, 3) // sps_max_sub_layers_minus1
    .u(1, 1) // sps_temporal_id_nesting_flag
    .u(0, 2)
    .u(0, 1)
    .u(1, 5) // Main profile
    .u(0x60000000, 32)
    .u(0b1001, 4)
    .u(0, 32)
    .u(0, 12)
    .u(93, 8) // level 3.1
    .ue(0) // sps_seq_parameter_set_id
    .ue(1) // chroma_format_idc 4:2:0
    .ue(64)
    .ue(64)
    .u(0, 1) // conformance_window_flag
    .ue(0)
    .ue(0)
    .ue(4) // log2_max_pic_order_cnt_lsb_minus4: POC LSBs are 8 bits
    .u(1, 1)
    .ue(4)
    .ue(2)
    .ue(0)
    .ue(0)
    .ue(3)
    .ue(0)
    .ue(3)
    .ue(0)
    .ue(0)
    .u(0, 1) // scaling_list_enabled_flag
    .u(0, 1)
    .u(0, 1)
    .u(0, 1) // pcm_enabled_flag
    .ue(0) // num_short_term_ref_pic_sets
    .u(1, 1) // long_term_ref_pics_present_flag
    .ue(1) // num_long_term_ref_pics_sps
    .u(0, 8) // lt_ref_pic_poc_lsb_sps[0]: fixed-width, 8 bits here
    .u(1, 1)
    .u(1, 1)
    .u(1, 1)
    .u(1, 1) // vui_parameters_present_flag
    .u(1, 1) // aspect_ratio_info_present_flag
    .u(255, 8) // Extended_SAR
    .u(4, 16)
    .u(3, 16)
    .u(0, 9) // the rest of the VUI absent
    .u(0, 1); // sps_extension_present_flag
  return [0x42, 0x01, ...withEmulationPrevention(b.rbsp())];
}

function hvcC(sps: number[]): Uint8Array {
  return new Uint8Array([
    1,
    0x01,
    0x60,
    0,
    0,
    0,
    0x90,
    0,
    0,
    0,
    0,
    0,
    93,
    0xf0,
    0,
    0xfc,
    0xfd,
    0xf8,
    0xf8,
    0,
    0,
    0x0f,
    1,
    0x80 | 33,
    0,
    1,
    sps.length >> 8,
    sps.length & 0xff,
    ...sps,
  ]);
}

async function anamorphicHevcMp4(): Promise<ArrayBuffer> {
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const video = new EncodedVideoPacketSource("hevc");
  output.addVideoTrack(video);
  await output.start();
  await video.add(new EncodedPacket(new Uint8Array(16), "key", 0, 1 / 30), {
    decoderConfig: {
      codec: "hvc1.1.6.L93.90",
      codedWidth: 64,
      codedHeight: 64,
      description: hvcC(spsWithLongTermRefs()),
    },
  });
  await output.finalize();
  return output.target.buffer!;
}

describe("the HEVC SPS reader studio ships", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps the pixel aspect ratio of HEVC that lists long-term reference pictures", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const input = new Input({
      source: new BufferSource(await anamorphicHevcMp4()),
      formats: [MP4],
    });
    const track = await input.getPrimaryVideoTrack();

    expect([await track!.getSquarePixelWidth(), await track!.getSquarePixelHeight()]).toEqual([
      85, 64,
    ]);
    expect(errors).not.toHaveBeenCalled();
    input.dispose();
  });
});
