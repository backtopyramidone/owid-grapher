FROM gitpod/workspace-full

USER gitpod

<<<<<<< HEAD
RUN apt update -y && apt install apt-utils tmux nodejs npm mysql-client -y && npm install -global yarn
=======
RUN sudo apt update -y &&
    sudo apt install apt-utils tmux nodejs npm mysql-client -y &&
    npm install -global yarn &&
>>>>>>> b723e985749a1c4ac6b4b0c68c431289ab102871
# Install custom tools, runtime, etc. using apt-get
# For example, the command below would install "bastet" - a command line tetris clone:
#
# RUN sudo apt-get -q update && \
#     sudo apt-get install -yq bastet && \
#     sudo rm -rf /var/lib/apt/lists/*
#
# More information: https://www.gitpod.io/docs/config-docker/
