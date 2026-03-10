# Contributing to Hyperframes

Thanks for your interest in contributing to Hyperframes! This guide will help you get started.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/hyperframes.git`
3. Install dependencies: `pnpm install`
4. Create a branch: `git checkout -b my-feature`

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [pnpm](https://pnpm.io/) 9+
- [FFmpeg](https://ffmpeg.org/) (for rendering)

### Install & Build

```bash
pnpm install
pnpm build
```

### Run Tests

```bash
pnpm test
```

## Making Changes

### Code Style

- TypeScript throughout
- ESLint + Prettier for formatting (run `pnpm lint` to check)
- Write tests for new functionality

### Commit Messages

Use [conventional commits](https://www.conventionalcommits.org/):

```
feat(core): add CSS frame adapter
fix(producer): handle missing FFmpeg gracefully
docs: update quick start guide
```

### Pull Requests

1. Keep PRs focused — one feature or fix per PR
2. Update documentation if your change affects the public API
3. Ensure all tests pass
4. Add a clear description of what changed and why

## Project Structure

```
hyperframes/
├── packages/
│   ├── core/              # @hyperframes/core
│   ├── cli/               # @hyperframes/cli
│   ├── producer/          # @hyperframes/producer
│   ├── studio/            # @hyperframes/studio
│   ├── mcp/               # @hyperframes/mcp
│   └── create-hyperframe/ # scaffolding CLI
├── templates/             # starter templates
├── docs/                  # documentation
└── examples/              # extended examples
```

## Reporting Issues

- Use [GitHub Issues](https://github.com/heygen-com/hyperframes/issues) for bug reports and feature requests
- Search existing issues before creating a new one
- Include reproduction steps for bugs

## Code of Conduct

Be respectful. We're building something together.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
