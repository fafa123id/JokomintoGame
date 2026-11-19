// Jenkins runs on the same host as the app and deploys with Docker Compose.
// Requirements:
//   Plugins: Pipeline, Git, GitHub, Docker Pipeline, Credentials Binding
//   Credential (Secret file): 'jokominto-env' -> the production .env
//   Job trigger: "GitHub hook trigger for GITScm polling" (webhook: <jenkins-url>/github-webhook/)

pipeline {
  agent any

  triggers { githubPush() }

  options {
    timeout(time: 20, unit: 'MINUTES')
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '15'))
    timestamps()
  }

  environment {
    APP = 'jokominto'
    IMAGE_TAG = "${env.GIT_COMMIT?.take(12) ?: env.BUILD_NUMBER}"
    TRIVY_IMAGE = 'aquasec/trivy:0.57.1'
  }

  stages {
    stage('Build Image') {
      steps {
        sh 'docker build --pull -t $APP:$IMAGE_TAG .'
      }
    }

    stage('Security Scan') {
      steps {
        sh '''
          docker run --rm \
            -v /var/run/docker.sock:/var/run/docker.sock \
            -v trivy-cache:/root/.cache/ \
            $TRIVY_IMAGE image --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed --no-progress \
            $APP:$IMAGE_TAG
        '''
      }
    }

    stage('Deploy') {
      when { anyOf { branch 'main'; expression { env.GIT_BRANCH == 'origin/main' } } }
      steps {
        withCredentials([file(credentialsId: 'jokominto-env', variable: 'ENV_FILE')]) {
          sh '''
            set -e
            install -m 600 "$ENV_FILE" .env
            docker network inspect shared-network >/dev/null 2>&1 || docker network create shared-network
            PREVIOUS=$(docker inspect --format '{{.Config.Image}}' ${APP}-app-1 2>/dev/null || true)
            echo "$PREVIOUS" > .previous_image

            IMAGE=$APP:$IMAGE_TAG docker compose -p $APP up -d --no-build --remove-orphans
          '''
        }
      }
    }

    stage('Health Check') {
      when { anyOf { branch 'main'; expression { env.GIT_BRANCH == 'origin/main' } } }
      steps {
        withCredentials([file(credentialsId: 'jokominto-env', variable: 'ENV_FILE')]) {
          sh '''
            for i in $(seq 1 30); do
              STATUS=$(docker inspect --format '{{.State.Health.Status}}' ${APP}-app-1 2>/dev/null || echo starting)
              [ "$STATUS" = "healthy" ] && echo "app is healthy" && exit 0
              sleep 2
            done
            echo "health check failed, rolling back"
            PREVIOUS=$(cat .previous_image)
            if [ -n "$PREVIOUS" ]; then
              install -m 600 "$ENV_FILE" .env
              IMAGE=$PREVIOUS docker compose -p $APP up -d --no-build
            fi
            exit 1
          '''
        }
      }
    }
  }

  post {
    always {
      sh 'rm -f .env'
      sh 'docker image prune -f >/dev/null 2>&1 || true'
    }
  }
}
