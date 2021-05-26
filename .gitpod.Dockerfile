FROM gitpod/workspace-full

USER gitpod
RUN sudo apt-get update -q && \
    sudo apt-get install apt-utils tmux nodejs npm mysql-client -yq && \
    sudo npm install -global yarn
