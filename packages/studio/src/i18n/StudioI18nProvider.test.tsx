// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { createInstance } from "i18next";
import { createStudioI18n } from "./createStudioI18n";
import { StudioI18nBoundary, StudioI18nProvider, useStudioTranslation } from "./StudioI18nProvider";
import { readStudioLanguage, writeStudioLanguage } from "./studioLanguage";
import { LanguageSwitcher } from "../components/LanguageSwitcher";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
function Probe() {
  const { t, instance, language } = useStudioTranslation();
  return (
    <>
      <span data-language={language}>{t("toolbar.export")}</span>
      <button onClick={() => void instance.changeLanguage("zh-CN")}>Switch</button>
    </>
  );
}
function mount(children: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(children));
  return host;
}
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  window.localStorage.clear();
  vi.restoreAllMocks();
});

it("updates one Studio without changing another instance or the host language", async () => {
  const hostI18n = createInstance();
  await hostI18n.init({ lng: "fr", resources: {} });
  const first = createStudioI18n();
  const second = createStudioI18n();
  document.documentElement.lang = "fr";
  const host = mount(
    <>
      <StudioI18nProvider instance={first}>
        <Probe />
      </StudioI18nProvider>
      <StudioI18nProvider instance={second}>
        <Probe />
      </StudioI18nProvider>
    </>,
  );
  await act(async () => {
    await first.changeLanguage("zh-CN");
  });
  expect([...host.querySelectorAll("span")].map((el) => el.textContent)).toEqual([
    "导出",
    "Export",
  ]);
  expect(second.language).toBe("en");
  expect(hostI18n.language).toBe("fr");
  expect(document.documentElement.lang).toBe("fr");
});

it("preserves an enclosing provider through the complete-app boundary", () => {
  const host = mount(
    <StudioI18nProvider language="zh-CN">
      <StudioI18nBoundary>
        <Probe />
      </StudioI18nBoundary>
    </StudioI18nProvider>,
  );
  expect(host.querySelector("span")?.textContent).toBe("导出");
});

it("starts embedded Studio in English without a switcher, browser preferences or storage", () => {
  writeStudioLanguage("zh-CN");
  const host = mount(
    <StudioI18nBoundary>
      <Probe />
      <LanguageSwitcher />
    </StudioI18nBoundary>,
  );
  expect(host.querySelector("span")?.textContent).toBe("Export");
  expect(readStudioLanguage()).toBe("zh-CN");
  expect(host.querySelector('[aria-label="Interface language"]')).toBeNull();
});

it("switches language from the standalone header menu", async () => {
  const host = mount(
    <StudioI18nProvider showLanguageSwitcher>
      <Probe />
      <LanguageSwitcher />
    </StudioI18nProvider>,
  );
  const trigger = host.querySelector('[aria-label="Interface language"]');
  if (!trigger) throw new Error("language menu not rendered");
  const init = { bubbles: true, cancelable: true, composed: true, detail: 1 };
  await act(async () => {
    trigger.dispatchEvent(new PointerEvent("pointerdown", { ...init, pointerType: "mouse" }));
    trigger.dispatchEvent(new MouseEvent("mousedown", init));
    trigger.dispatchEvent(new PointerEvent("pointerup", { ...init, pointerType: "mouse" }));
    trigger.dispatchEvent(new MouseEvent("mouseup", init));
    trigger.dispatchEvent(new MouseEvent("click", init));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const chinese = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
    (item) => item.textContent === "简体中文",
  );
  await act(async () => chinese?.click());
  expect(host.querySelector("span")?.textContent).toBe("导出");
  expect(host.querySelector('[aria-label="界面语言"]')).not.toBeNull();
});

it("persists a manual selection and restores it on the next mount ahead of the browser locale", async () => {
  const first = createStudioI18n();
  mount(
    <StudioI18nProvider instance={first} persistLanguage>
      <Probe />
    </StudioI18nProvider>,
  );
  await act(async () => {
    await first.changeLanguage("zh-CN");
  });
  expect(readStudioLanguage()).toBe("zh-CN");
  act(() => root?.unmount());
  const host = mount(
    <StudioI18nProvider detectBrowserLanguage persistLanguage>
      <Probe />
    </StudioI18nProvider>,
  );
  expect(host.querySelector("span")?.textContent).toBe("导出");
});

it("detects Simplified Chinese when no preference is saved", () => {
  vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["zh-CN", "en"]);
  const host = mount(
    <StudioI18nProvider detectBrowserLanguage>
      <Probe />
    </StudioI18nProvider>,
  );
  expect(host.querySelector("span")?.textContent).toBe("导出");
});

it("honors host-controlled language over saved preferences, including updates", async () => {
  writeStudioLanguage("zh-CN");
  const view = (language: "en" | "zh-CN") => (
    <StudioI18nProvider language={language} persistLanguage showLanguageSwitcher>
      <Probe />
      <LanguageSwitcher />
    </StudioI18nProvider>
  );
  const host = mount(view("en"));
  expect(host.querySelector("span")?.textContent).toBe("Export");
  expect(host.querySelector('[aria-label="Interface language"]')).toBeNull();
  await act(async () => {
    root?.render(view("zh-CN"));
  });
  expect(host.querySelector("span")?.textContent).toBe("导出");
  expect(readStudioLanguage()).toBe("zh-CN");
});

it("switches in memory when localStorage reads and writes throw", async () => {
  vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const instance = createStudioI18n();
  const host = mount(
    <StudioI18nProvider instance={instance} persistLanguage>
      <Probe />
    </StudioI18nProvider>,
  );
  await act(async () => {
    await instance.changeLanguage("zh-CN");
  });
  expect(host.querySelector("span")?.textContent).toBe("导出");
  expect(readStudioLanguage()).toBeNull();
});
