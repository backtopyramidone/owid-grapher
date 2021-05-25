mysql -u root -h 127.0.0.1 -e "CREATE DATABASE owid;"
curl -Lo /tmp/owid_metadata.sql.gz https://files.ourworldindata.org/owid_metadata.sql.gz
gunzip < /tmp/owid_metadata.sql.gz | mysql -u root -h 127.0.0.1 -D owid
curl -Lo /tmp/owid_chartdata.sql.gz https://files.ourworldindata.org/owid_chartdata.sql.gz
gunzip < /tmp/owid_chartdata.sql.gz | mysql -u root -h 127.0.0.1 -D owid