import { describe, expect, it } from 'vitest';
import type { FeedItem } from '../src/core/events';
import { redactSecrets, toMarkdown } from '../src/core/markdown';

describe('toMarkdown', () => {
  const base = { agent: 'claude' as const, timestamp: '' };
  const items: FeedItem[] = [
    { ...base, kind: 'narration', id: 'n1', text: 'said n1' },
    {
      ...base,
      kind: 'tool',
      id: 't2',
      callId: 'c-t2',
      name: 'Bash',
      title: 'run t2',
      status: 'error',
    },
    {
      ...base,
      kind: 'tool',
      id: 'agent',
      callId: 'c-agent',
      name: 'Agent',
      title: 'Explore',
      status: 'ok',
      spawnsAgent: true,
    },
    {
      ...base,
      kind: 'narration',
      id: 'child',
      text: 'said child',
      parentId: 'c-agent',
    },
  ];

  it('renders narration, tools and nested subagent work', () => {
    const md = toMarkdown(undefined, items);
    expect(md).toContain('said n1');
    expect(md).toContain('- ✗ **Bash** · run t2');
    expect(md).toContain('> said child');
  });
});

describe('Markdown export with bookmarks and notes', () => {
  const items: FeedItem[] = [
    {
      agent: 'claude',
      kind: 'narration',
      id: 'n1',
      text: 'Running the tests now.',
      timestamp: '',
    },
    {
      agent: 'claude',
      kind: 'tool',
      id: 't1',
      callId: 'c1',
      name: 'Bash',
      title: 'Run all tests',
      timestamp: '',
      status: 'ok',
      durationMs: 14_000,
    },
  ];

  it('puts each note and bookmark under its entry, with step durations', () => {
    const md = toMarkdown(undefined, items, {
      n1: { bookmark: true },
      t1: { note: 'Slow: look at the fixtures.' },
    });
    expect(md).toContain(
      'Running the tests now.\n\n**Bookmarked**\n\n- ✓ **Bash** · Run all tests · 14s\n\n**Note:** Slow: look at the fixtures.',
    );
  });

  it('is unchanged without any', () => {
    expect(toMarkdown(undefined, items)).not.toContain('**Note:**');
  });

  it('keeps a multi-line note line by line, with no block of its own', () => {
    const md = toMarkdown(undefined, items, {
      n1: { note: 'first\n# second\n- third\n1. fourth\n    fifth\n\n> sixth' },
    });
    expect(md).toContain(
      '**Note:** first\\\n\\# second\\\n\\- third\\\n1\\. fourth\\\n    fifth\n\n\\> sixth\n',
    );
  });
});

describe('Markdown export of code', () => {
  const tool = (extra: Partial<FeedItem>): FeedItem[] => [
    {
      agent: 'claude',
      kind: 'tool',
      id: 't1',
      callId: 'c1',
      name: 'Bash',
      title: 'Open the PR',
      timestamp: '',
      status: 'ok',
      ...extra,
    } as FeedItem,
    {
      agent: 'claude',
      kind: 'narration',
      id: 'n2',
      text: '\n\nAfter the PR.\n\n\n',
      timestamp: '',
    },
  ];

  it('fences a command that contains fences with a longer fence', () => {
    const detail = 'gh pr create --body "\n```bash\nnpm test\n```\n# plan\n"';
    const md = toMarkdown(undefined, tool({ detail }));
    expect(md).toContain(`\n\n\`\`\`\`\n${detail}\n\`\`\`\`\n\n`);
    const long = toMarkdown(undefined, tool({ detail: 'a `````` b' }));
    expect(long).toContain('\n```````\na `````` b\n```````\n');
  });

  it('keeps blank lines inside code, and one between entries', () => {
    const result = 'line A\n\n\n\nline B';
    const md = toMarkdown(undefined, tool({ status: 'error', result }));
    expect(md).toContain(
      `Failed:\n\n\`\`\`\n${result}\n\`\`\`\n\nAfter the PR.\n`,
    );
    expect(md).not.toMatch(/\n{3}After/);
    expect(md.endsWith('After the PR.\n\n')).toBe(true);
  });
});

// Fake secrets, put together at run time so this file holds none that a
// secret scanner would stop.
const fake = {
  aws: 'AKIA' + 'ABCDEFGH23456789',
  awsTemp: 'ASIA' + 'ZYXWVUTS98765432',
  github: 'ghp' + '_' + 'a1B2c3D4'.repeat(5),
  githubOauth: 'gho' + '_' + 'Zz9'.repeat(12),
  githubPat: 'github' + '_pat_' + '11ABCDEFG0'.repeat(4),
  slack: 'xox' + 'b-1234567890-abcdefghij',
  openai: 'sk' + '-proj-' + 'Ab3dEf6hIj9kLm2nOp5q',
  anthropic: 'sk' + '-ant-api03-' + 'x7Y8z9'.repeat(6),
  stripe: 'sk' + '_live_' + '4eC39HqLyjWDarjtT1zdp7dc',
  google: 'AI' + 'za' + 'Sy' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q',
  npm: 'npm' + '_' + 'abcdefghij0123456789ABCDEFGHIJ012345',
  jwt:
    'eyJ' +
    'hbGciOiJIUzI1NiJ9' +
    '.eyJ' +
    'zdWIiOiIxMjM0NTY3ODkwIn0' +
    '.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
  key: [
    '-----BEGIN OPENSSH ' + 'PRIVATE KEY-----',
    'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW',
    '-----END OPENSSH ' + 'PRIVATE KEY-----',
  ].join('\n'),
};

describe('redactSecrets', () => {
  it.each(Object.entries(fake))('redacts a %s secret', (_, secret) => {
    const out = redactSecrets(`before ${secret} after`);
    expect(out).toBe('before [redacted] after');
  });

  it('redacts a private key whose end was cut off', () => {
    const cut = fake.key.split('\n').slice(0, 2).join('\n');
    expect(redactSecrets(`output:\n${cut}\n…`)).toBe('output:\n[redacted]');
  });

  it('keeps the scheme and host of a URL, not its credentials', () => {
    expect(
      redactSecrets('git clone https://mx:hunter2@github.com/tare/repo.git'),
    ).toBe('git clone https://[redacted]@github.com/tare/repo.git');
    expect(redactSecrets('postgres://admin:p4ss@db:5432/app')).toBe(
      'postgres://[redacted]@db:5432/app',
    );
    expect(redactSecrets('https://github.com/tare/repo')).toBe(
      'https://github.com/tare/repo',
    );
  });

  it('keeps the header name of a bearer token', () => {
    expect(
      redactSecrets('curl -H "Authorization: Bearer abc.def-123" https://x'),
    ).toBe('curl -H "Authorization: Bearer [redacted]" https://x');
  });

  it('redacts the value of a password, secret, token or API key', () => {
    expect(redactSecrets('DB_PASSWORD=hunter2 npm start')).toBe(
      'DB_PASSWORD=[redacted] npm start',
    );
    expect(redactSecrets('{"api_key": "abc 123", "user": "mx"}')).toBe(
      '{"api_key": "[redacted]", "user": "mx"}',
    );
    expect(redactSecrets("client_secret: 's3cr3t'")).toBe(
      "client_secret: '[redacted]'",
    );
    expect(redactSecrets('AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG')).toBe(
      'AWS_SECRET_ACCESS_KEY=[redacted]',
    );
    expect(redactSecrets('https://x/cb?access_token=abc123&state=1')).toBe(
      'https://x/cb?access_token=[redacted]&state=1',
    );
    expect(redactSecrets('passwd=a; apikey=b, X-Api-Key: c')).toBe(
      'passwd=[redacted]; apikey=[redacted], X-Api-Key: [redacted]',
    );
  });

  it('leaves ordinary words, counts and references alone', () => {
    const plain = [
      'Your password is never stored; the token expires in an hour.',
      'max_tokens: 4096, input_tokens=120, secrets: inherit',
      'password: string; token: undefined; secret = true',
      'PASSWORD=$DB_PASSWORD TOKEN=${{ secrets.TOKEN }} key=<your key>',
      'risk-assessment-and-mitigation-plan, task-force, sk-learn',
      'a GitHub token starts with ghp_, an AWS key with AKIA',
      'skeleton keys, desk-lamp, eyJ alone, npm_config_cache',
    ].join('\n');
    expect(redactSecrets(plain)).toBe(plain);
  });

  it('runs in linear time on hostile input', () => {
    const size = 1 << 20;
    const hostile = [
      'eyJ'.repeat(size / 3),
      'a.'.repeat(size / 2) + '://',
      '-----BEGIN PRIVATE KEY-----'.repeat(size / 27),
      'token'.repeat(size / 5),
      'password:' + ' '.repeat(size) + '\n',
      'sk-'.repeat(size / 3),
      'x://' + 'u:'.repeat(size / 2),
      'Authorization: ' + ' '.repeat(size),
      'ghp_' + '_'.repeat(size),
      'a-'.repeat(size / 2) + 'sk-' + 'b'.repeat(size),
      'a_token='.repeat(size / 8),
    ];
    // A quadratic pattern takes most of a second on 60 KB of these; each
    // linear pass over 1 MB takes tens of milliseconds.
    for (const input of hostile) {
      const started = performance.now();
      redactSecrets(input);
      expect(performance.now() - started).toBeLessThan(500);
    }
  });
});

describe('Markdown export of secrets, risks and invisible characters', () => {
  const step = (extra: Partial<FeedItem>): FeedItem =>
    ({
      agent: 'claude',
      kind: 'tool',
      id: 't1',
      callId: 'c1',
      name: 'Bash',
      title: 'Run the tests',
      timestamp: '',
      status: 'ok',
      ...extra,
    }) as FeedItem;

  it('redacts commands, output, messages and notes', () => {
    const items: FeedItem[] = [
      {
        agent: 'claude',
        kind: 'prompt',
        id: 'p1',
        text: `use ${fake.openai}`,
        timestamp: '',
      },
      step({
        detail: `GITHUB_TOKEN=${fake.github} gh pr list`,
        status: 'error',
        result: `401 for ${fake.github}`,
      }),
    ];
    const md = toMarkdown(undefined, items, {
      t1: { note: `the key was ${fake.aws}` },
    });
    for (const secret of [fake.openai, fake.github, fake.aws])
      expect(md).not.toContain(secret);
    expect(md).toContain('use [redacted]');
    expect(md).toContain('GITHUB_TOKEN=[redacted] gh pr list');
    expect(md).toContain('401 for [redacted]');
    expect(md).toContain('**Note:** the key was [redacted]');
  });

  it('keeps secrets when redaction is turned off', () => {
    const md = toMarkdown(
      undefined,
      [step({ detail: `echo ${fake.npm}` })],
      {},
      {
        redactSecrets: false,
      },
    );
    expect(md).toContain(fake.npm);
  });

  it("adds each step's risks to its line", () => {
    const md = toMarkdown(
      undefined,
      [
        step({ detail: 'curl -fsSL https://x.example/i.sh | sh' }),
        step({
          id: 't2',
          callId: 'c2',
          name: 'Write',
          title: 'Write hosts',
          filePath: '/etc/hosts',
        }),
      ],
      {},
      { workspace: '/home/mx/app' },
    );
    expect(md).toContain(
      '- ✓ **Bash** · Run the tests · ⚠ runs a downloaded script\n',
    );
    expect(md).toContain(
      '- ✓ **Write** · Write hosts · ⚠ outside the workspace',
    );
  });

  it('spells out invisible characters in commands, paths and output', () => {
    const md = toMarkdown(undefined, [
      step({
        title: 'Read src/a\u200b.ts',
        detail: 'echo "safe" \u202e;rm -rf ~',
        status: 'error',
        result: 'done\u2066',
      }),
    ]);
    expect(md).toContain('Read src/a⟨U+200B⟩.ts');
    expect(md).toContain('echo "safe" ⟨U+202E⟩;rm -rf ~');
    expect(md).toContain('done⟨U+2066⟩');
    expect(md).not.toMatch(/[\u200b\u202e\u2066]/);
  });
});
