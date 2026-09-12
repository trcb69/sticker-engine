/**
 * PM2 process definition.
 *
 * Deliberately fork mode with a single instance. Cluster mode would fork
 * several workers that do not share memory, and two things here break
 * immediately if that happens:
 *
 *   1. The job store is in-process. An operator's PATCH would land on a worker
 *      that has never seen their job.
 *   2. The print queue is serialised per printer so two operators cannot
 *      interleave labels on one machine. Separate workers each keep their own
 *      queue, which defeats it.
 *
 * If this ever needs to scale beyond one process, both have to move to shared
 * storage first. Until then, one process is the correct answer, not a
 * limitation.
 */
module.exports = {
  apps: [{
    name: 'sticker-engine',
    script: 'src/server.js',
    cwd: __dirname,

    // Node 20 reads the env file itself, so secrets stay out of this file and
    // out of git.
    node_args: ['--env-file=.env'],

    exec_mode: 'fork',
    instances: 1,

    autorestart: true,
    max_restarts: 10,
    min_uptime: '20s',
    restart_delay: 2000,

    // Poppler is spawned per upload. A leak would show up here rather than as
    // a slow degradation nobody notices.
    max_memory_restart: '400M',

    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
    merge_logs: true,
    time: true,

    // Only what PM2 needs to start the process. Everything else lives in .env.
    env: {
      NODE_ENV: 'production',
      STICKER_PORT: '6969',
      STICKER_HOST: '127.0.0.1',
    },
  }],
};
