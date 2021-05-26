#this bash script waits for a file to be created and terminates
wait_file() {
  local file="$1"; shift
  local wait_seconds="${1:-10}"; shift # 10 seconds as default timeout

  until test $((wait_seconds--)) -eq 0 -o -e "$file" ; do sleep 1; done

  ((++wait_seconds))
}
# Use the default timeout of 10 seconds:
wait_file "initdone" && {
  echo "File found, proceeding"
}