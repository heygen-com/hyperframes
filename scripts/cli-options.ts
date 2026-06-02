export type InlineValueOption<Key extends string> = {
  prefix: string;
  key: Key;
};

export const CLI_SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

type ParserConfig<
  Parsed extends object,
  ValueKey extends keyof Parsed & string,
  BooleanKey extends keyof Parsed & string,
> = {
  inlineValueOptions: Array<InlineValueOption<ValueKey>>;
  valueOptions: Map<string, ValueKey>;
  booleanOptions: Map<string, BooleanKey>;
  parsePositional: (arg: string, index: number) => number;
  fail: (message: string) => never;
};

export function parseMappedArgument<
  Parsed extends object,
  ValueKey extends keyof Parsed & string,
  BooleanKey extends keyof Parsed & string,
>(
  args: string[],
  index: number,
  parsed: Parsed,
  config: ParserConfig<Parsed, ValueKey, BooleanKey>,
) {
  const arg = args[index];

  if (applyInlineValueOption(arg, parsed, config.inlineValueOptions)) {
    return index;
  }
  if (applyBooleanOption(arg, parsed, config.booleanOptions)) {
    return index;
  }

  return applyValueOrPositionalOption(args, index, parsed, config, arg);
}

function applyInlineValueOption<Parsed extends object, ValueKey extends keyof Parsed & string>(
  arg: string,
  parsed: Parsed,
  inlineOptions: Array<InlineValueOption<ValueKey>>,
) {
  const option = inlineOptions.find((candidate) => arg.startsWith(candidate.prefix));
  if (!option) {
    return false;
  }

  parsed[option.key] = arg.slice(option.prefix.length) as Parsed[ValueKey];
  return true;
}

function applyBooleanOption<Parsed extends object, BooleanKey extends keyof Parsed & string>(
  arg: string,
  parsed: Parsed,
  booleanOptions: Map<string, BooleanKey>,
) {
  const option = booleanOptions.get(arg);
  if (!option) {
    return false;
  }

  parsed[option] = true as Parsed[BooleanKey];
  return true;
}

function applyValueOrPositionalOption<
  Parsed extends object,
  ValueKey extends keyof Parsed & string,
  BooleanKey extends keyof Parsed & string,
>(
  args: string[],
  index: number,
  parsed: Parsed,
  config: ParserConfig<Parsed, ValueKey, BooleanKey>,
  arg: string,
) {
  const option = config.valueOptions.get(arg);
  if (!option) {
    return config.parsePositional(arg, index);
  }

  parsed[option] = readNextArg(args, index, arg, config.fail) as Parsed[ValueKey];
  return index + 1;
}

export function parseVersionOptionArgument<
  Parsed extends { version?: string },
  ValueKey extends keyof Parsed & string,
  BooleanKey extends keyof Parsed & string,
>(
  args: string[],
  index: number,
  parsed: Parsed,
  config: Omit<ParserConfig<Parsed, ValueKey, BooleanKey>, "parsePositional"> & {
    printUsage: () => void;
  },
) {
  return parseMappedArgument(args, index, parsed, {
    ...config,
    parsePositional: (arg, positionalIndex) =>
      parseVersionOrHelp(arg, positionalIndex, parsed, config),
  });
}

function parseVersionOrHelp<Parsed extends { version?: string }>(
  arg: string,
  index: number,
  parsed: Parsed,
  config: { printUsage: () => void; fail: (message: string) => never },
) {
  if (arg === "--help" || arg === "-h") {
    config.printUsage();
    process.exit(0);
  }

  parsed.version = parseVersionPositionalArg(arg, parsed.version, config.fail);
  return index;
}

export function parseVersionPositionalArg(
  arg: string,
  currentVersion: string | undefined,
  fail: (message: string) => never,
) {
  if (arg.startsWith("--")) {
    fail(`Unknown option: ${arg}`);
  }
  if (currentVersion) {
    fail(`Unexpected positional argument: ${arg}`);
  }

  return arg.replace(/^v/, "");
}

export function readNextArg(
  args: string[],
  index: number,
  flag: string,
  fail: (message: string) => never,
) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    fail(`Missing value for ${flag}`);
  }
  return value;
}

export function validateCliVersion(
  version: string,
  pattern: RegExp,
  fail: (message: string) => never,
) {
  if (!pattern.test(version)) {
    fail(`Invalid semver: ${version}`);
  }
}

export function validateCliDate(date: string, fail: (message: string) => never) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    fail(`Invalid date: ${date}. Expected YYYY-MM-DD.`);
  }
}

export function optionalFlagArg(flag: string, enabled: boolean) {
  return enabled ? [flag] : [];
}

export function optionalValueArg(flag: string, value: string | undefined) {
  return value ? [flag, value] : [];
}
