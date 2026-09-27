export const SDR_RGB_TO_BT709_FILTER = "scale=out_color_matrix=bt709:out_range=tv:flags=neighbor";

export const SDR_CAPTURE_TO_BT709_FILTER = `scale=in_color_matrix=bt601:in_range=pc:flags=neighbor,format=gbrp,${SDR_RGB_TO_BT709_FILTER}`;
