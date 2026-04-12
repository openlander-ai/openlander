module.exports = {
  apps: [
    {
      name: 'openlander',
      script: './dist/cli/index.js',
      // 'start'를 인자로 주면 내부적으로 백그라운드용 unix socket 데몬 모드로 실행할 수도 있고, 
      // 인자 없이 실행하면 기본 웹 모드(기본 포트 10114)로 실행됩니다.
      args: '', 
      env: {
        NODE_ENV: 'production',
      },
      // 옵셔널: 에러 로그나 출력 로그 위치를 커스텀하고 싶다면 아래를 활용하세요.
      // error_file: './logs/err.log',
      // out_file: './logs/out.log',
      // time: true
    }
  ]
};
