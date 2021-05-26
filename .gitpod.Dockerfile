FROM gitpod/workspace-full

USER gitpod

<<<<<<< HEAD
RUN sudo apt-get update -q && \
    sudo apt-get install apt-utils tmux nodejs npm mysql-client -yq && \
    npm install -global yarn

=======
<<<<<<< HEAD
RUN apt update -y && apt install apt-utils tmux nodejs npm mysql-client -y && npm install -global yarn
=======
RUN sudo apt update -y &&
    sudo apt install apt-utils tmux nodejs npm mysql-client -y &&
    npm install -global yarn &&
>>>>>>> b723e985749a1c4ac6b4b0c68c431289ab102871
>>>>>>> 039d57c1cf70f88c164c8c8a8e07c21c63b79fb1
# Install custom tools, runtime, etc. using apt-get
# For example, the command below would install "bastet" - a command line tetris clone:
#
# RUN sudo apt-get -q update && \
#     sudo apt-get install -yq bastet && \
#     sudo rm -rf /var/lib/apt/lists/*
#
# More information: https://www.gitpod.io/docs/config-docker/
