import os
import re

workspaceURL = (os.environ['GITPOD_WORKSPACE_URL'])
strippedURL = (workspaceURL.replace('https://',''))

webpack = ("https://8090-" + strippedURL)
baked = ("https://3030-" + strippedURL)


#os.system("export " "WEBPACK_DEV_URL=\"" + webpack + "\"")
#os.system("export " "BAKED_BASE_URL=\"" + baked + "\"")

file = open('.env', 'r')
filelist = file.readlines()
file.close()
found = False
for line in filelist:
    if str("WEBPACK_DEV_URL") in line:
        print ("Found it, not modifying file")
        found = True

if not found:
    with open('.env', 'a') as file1:
        file1.write("\nWEBPACK_DEV_URL=" + webpack)
        file1.write("\nBAKED_BASE_URL=" + baked)
        print ("appended WEBPACK_DEV_URL and BAKED_BASE_URL to .env file ")






