#!/bin/bash
set -e

if [ $# -eq 0 ]
  then
    echo "usage: ./build-machines [number_of_machines] /path/to/server/cert/lamassu_op_root_ca.pem /path/to/machine/" && exit 1
fi

case $1 in
    ''|*[!0-9]*) echo "usage: ./build-machines [number_of_machines] /path/to/server/cert/lamassu_op_root_ca.pem /path/to/machine/" && exit 1;;
esac

SERVER_CERT=$(perl -pe 's/\n/\\n/' < $2)
if [ -z "$SERVER_CERT" ]
  then
    echo "Lamassu-op-root-ca.pem is empty" && exit 1
fi

# Remove old folders
rm -rf ./machines/*

# Create stress database
sudo psql postgres -c "drop database if exists lamassu_stress" -U postgres
sudo psql postgres -c "create database lamassu_stress with template lamassu" -U postgres

START=1
END=$1
for (( c=$START; c<=$END; c++ ))
do
  echo "Creating machine $c out of $END..."
  NUMBER=$c
  mkdir -p ./machines/$NUMBER/
  cp "$3"/data/client.sample.pem ./machines/$NUMBER/
  cp "$3"/data/client.sample.key ./machines/$NUMBER/


  cat > ./machines/$NUMBER/connection_info.json << EOL
  {"host":"localhost","ca":"$SERVER_CERT"}
EOL

  echo 'Generating certs...'
  node ./utils/init-cert.js $NUMBER

  # Get device_id
  DEVICE_ID=`openssl x509 -outform der -in ./machines/$NUMBER/client.pem | sha256sum | cut -d " " -f 1`

  # Update db config
  NEW_CONFIG=$(node ./utils/save-config.js $NUMBER $DEVICE_ID)
  sudo psql "lamassu_stress" -U postgres << EOF
    insert into user_config(type, data, created, valid) 
    values('config', '$NEW_CONFIG', now(), 't')
EOF

  # Add device on db
  sudo psql "lamassu_stress" -U postgres << EOF
    insert into devices(device_id, cashbox, cassette1, cassette2, paired, display, created, name, last_online, location) 
    values ('$DEVICE_ID', 0, 0, 0, 't', 't', now(), $NUMBER, now(), '{}'::json)
EOF
done

echo "Done!"
