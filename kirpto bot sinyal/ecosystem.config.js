// PM2 config for kriptobot
module.exports = {
  apps: [
    {
      name: 'kriptobot',
      script: 'index.js',
      cwd: __dirname,
      watch: false,
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      max_restarts: 5
    }
  ]
};
