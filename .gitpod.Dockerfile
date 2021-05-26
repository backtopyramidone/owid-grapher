FROM gitpod/workspace-full

USER gitpod

RUN sudo apt update -y &&
    sudo apt install apt-utils tmux nodejs npm mysql-client -y &&
    npm install -global yarn &&
# Install custom tools, runtime, etc. using apt-get
# For example, the command below would install "bastet" - a command line tetris clone:
#
# RUN sudo apt-get -q update && \
#     sudo apt-get install -yq bastet && \
#     sudo rm -rf /var/lib/apt/lists/*
#
# More information: https://www.gitpod.io/docs/config-docker/
