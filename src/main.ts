import { runAction } from './lib/actions.ts';
import { Git } from './lib/git.ts';
import { GitHub } from './lib/github.ts';
import { readConfig } from './config.ts';
import { run } from './run.ts';

await runAction(async (rt) => {
  const config = readConfig(rt.inputs, rt.env);
  if (config.token) rt.mask(config.token);
  // Keep inputs (including the token) out of git's environment.
  const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('INPUT_')));
  let github: GitHub | undefined;
  return run(config, {
    git: new Git(config.cwd, gitEnv),
    github: () =>
      (github ??= new GitHub({
        token: config.token,
        userAgent: 'cruxstack/git-list-changed-files-action',
        apiUrl: rt.env['GITHUB_API_URL'],
        log: rt.log,
      })),
    log: rt.log,
  });
});
