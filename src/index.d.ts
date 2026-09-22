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
  /** Watch the report build up while the tests run. Also enabled with AURORA_LIVE=1; never on CI. */
  live?: boolean | {
    enabled?: boolean;
    /** First port to try; the next free one is used if it is taken (default 4321). */
    port?: number;
    /** Open the live page in your browser as soon as the run starts (default true). */
    open?: boolean;
    /** Seconds to keep the live server up after the run ends (default 0). */
    hold?: number;
  };
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
    /** true = defaults, false = off, or fine-grained options. */
    console?: boolean | ConsoleCaptureOptions;
    pageErrors?: boolean;
    /** true = defaults, false = off, or fine-grained options. */
    network?: boolean | NetworkCaptureOptions;
  };
  charts?: Partial<Record<'trend' | 'timeline' | 'slowest' | 'suites' | 'failureReasons' | 'projects', boolean>>;
  history?: { enabled?: boolean; keep?: number };
  slowTestThreshold?: number;
  environment?: Record<string, string | number | boolean>;
  links?: { issue?: string; ci?: string };
}

/** A URL to leave out of (or limit the report to): substring, * wildcard, RegExp, or a predicate. */
export type UrlPattern = string | RegExp | ((url: string, request?: unknown) => boolean);

export interface ConsoleCaptureOptions {
  enabled?: boolean;
  /** Console levels to record (default ['error', 'warning']). */
  levels?: Array<'error' | 'warning' | 'info' | 'log' | 'debug'>;
  /** Read the logged values — objects, Errors with stacks — not just the text (default true). */
  args?: boolean;
  /** Each logged value is cut off after this many characters (default 4000). */
  maxArgSize?: number;
  /** Messages to leave out of the report, matched against the text and the source URL. */
  exclude?: UrlPattern[];
}

export interface NetworkCaptureOptions {
  enabled?: boolean;
  /** Responses with this status or higher count as failures (default 400). */
  failedStatus?: number;
  /** Also record requests that never got a response (default true). */
  requestFailures?: boolean;
  requestHeaders?: boolean;
  requestBody?: boolean;
  responseHeaders?: boolean;
  responseBody?: boolean;
  /** Bodies longer than this are cut off, in bytes (default 4096). */
  maxBodySize?: number;
  /** Header values replaced with "«hidden»" in the report. */
  redactHeaders?: string[];
  /** URLs to leave out of the report — analytics, pixels, noisy third parties. */
  exclude?: UrlPattern[];
  /** When set, only URLs matching these are recorded. */
  include?: UrlPattern[];
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
