import { installInspection } from "../../core/src/runtime/inspection";
const live = (window as unknown as { __hfLiveInspection: { generation: string } })
  .__hfLiveInspection;
installInspection(window, live.generation);
