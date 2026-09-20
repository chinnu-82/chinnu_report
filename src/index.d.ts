import type { PlaywrightTestConfig, Locator, Page, TestType, PlaywrightTestArgs, PlaywrightTestOptions, PlaywrightWorkerArgs, PlaywrightWorkerOptions, Expect } from '@playwright/test';

export type CaptureMode = 'on' | 'off' | 'on-failure' | boolean;

export interface AuroraOptions {
  title?: string;
  subtitle?: string;
  /** Path or URL of a logo image. */
  logo?: string | null;
  outputDir?: string;
  /** Write each run to <outputDir>/<timestamp>/ and list them all at <outputDir>/index.html. */
  timestampedRuns?: boolean;
  /** How many timestamped run folders to keep (0 = keep everything). */
  keepRuns?: number;
  open?: 'always' | 'never' | 'on-failure';
  /** Embed all media into index.html (one portable file). */
  singleFile?: boolean;
  theme?: { mode?: 'auto' | 'light' | 'dark'; accent?: string };
  capture?: {
    stepScreenshots?: CaptureMode;
    failureScreenshot?: boolean;
    failureHtml?: boolean;
    fullPage?: boolean;
    video?: 'on' | 'off' | 'retain-on-failure' | 'on-first-retry';
    trace?: 'on' | 'off' | 'retain-on-failure' | 'on-first-retry';
    console?: boolean;
    pageErrors?: boolean;
    network?: boolean;
  };
  charts?: Partial<Record<'trend' | 'timeline' | 'slowest' | 'suites' | 'failureReasons' | 'projects', boolean>>;
  history?: { enabled?: boolean; keep?: number };
  slowTestThreshold?: number;
  environment?: Record<string, string | number | boolean>;
  links?: { issue?: string; ci?: string };
}

export interface StepOptions {
  screenshot?: CaptureMode;
  highlight?: Locator | Locator[];
  fullPage?: boolean;
  page?: Page;
  box?: boolean;
}

export interface Report {
  step<T>(title: string, body: () => Promise<T> | T, options?: StepOptions): Promise<T>;
  step(title: string, options?: StepOptions): Promise<void>;
  check(title: string, body: () => Promise<unknown> | unknown, options?: StepOptions): Promise<boolean>;
  screenshot(title?: string, options?: StepOptions): Promise<string | null>;
  note(text: string, level?: 'info' | 'warn' | 'success'): void;
  attach(title: string, data: unknown, contentType?: string): Promise<void>;
  usePage(page: Page): void;
  severity(level: 'blocker' | 'critical' | 'high' | 'medium' | 'low' | string): void;
  owner(name: string): void;
  feature(name: string): void;
  issue(id: string): void;
  description(text: string): void;
  link(url: string, label?: string): void;
}

export const test: TestType<PlaywrightTestArgs & PlaywrightTestOptions & { report: Report }, PlaywrightWorkerArgs & PlaywrightWorkerOptions>;
export const expect: Expect;
export function withAurora<T extends PlaywrightTestConfig>(config: T, options?: AuroraOptions): T;
export function defineAuroraConfig(options: AuroraOptions): AuroraOptions;
export const DEFAULTS: Required<AuroraOptions>;
