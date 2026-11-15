#!/bin/bash
# roult 20M training loop — cosine-restart chunks, ~9 min each
cd /home/z/my-project
mkdir -p data/roult2
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  echo "=== CHUNK $i $(date +%H:%M:%S) ===" >> data/roult2/loop.log
  python3 scripts/roult2/train.py run 150 0.0012 0.00035 530 >> data/roult2/loop.log 2>&1
done
echo "=== TRAINING LOOP DONE $(date +%H:%M:%S) ===" >> data/roult2/loop.log
