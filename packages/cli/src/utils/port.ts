export function parsePort(value: string, option = "--port"): number {
  const message = `${option} must be an integer between 1 and 65535`;
  if (!/^\d+$/.test(value)) throw new Error(message);

  const port = Number(value);
  if (port < 1 || port > 65535) throw new Error(message);
  return port;
}
