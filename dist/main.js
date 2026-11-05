import { runAction } from './lib/actions.js';
import { Git } from './lib/git.js';
import { GitHub } from './lib/github.js';
import { readConfig } from './config.js';
import { run } from './run.js';
await runAction(async (rt) => {
    const config = readConfig(rt.inputs, rt.env);
    if (config.token)
        rt.mask(config.token);
    // Keep inputs (including the token) out of git's environment.
    const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('INPUT_')));
    let github;
    return run(config, {
        git: new Git(config.cwd, gitEnv),
        github: () => (github ??= new GitHub({
            token: config.token,
            userAgent: 'cruxstack/git-list-changed-files-action',
            apiUrl: rt.env['GITHUB_API_URL'],
            log: rt.log,
        })),
        log: rt.log,
    });
});
