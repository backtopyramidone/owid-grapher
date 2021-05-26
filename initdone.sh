#this bash script waits for a file to be created and terminates
while ! test -f "initdone"; do
  sleep 10
  echo "Still waiting"
done