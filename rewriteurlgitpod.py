import os
import subprocess

workspaceURL = (os.environ['GITPOD_WORKSPACE_URL'])
strippedURL = (workspaceURL.replace('https://',''))

webpack = ("https://8090-" + strippedURL)
baked = ("https://3030-" + strippedURL)

os.system('cd ~')
os.system("export " "WEBPACK_DEV_URL=\"" + webpack + "\"")
os.system("export " "BAKED_BASE_URL=\"" + baked + "\"")
