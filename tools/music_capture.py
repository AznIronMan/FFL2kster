"""Record every song of the sound driver (bank 0E; request byte FFB0, current FFB3; song table
0E:49F5, 3 channel pointers per song) to WAV via PyBoy.
Requires sound-enabled states: python -c "from ffl2kster.states import make_states;
make_states('input/original.gb','build/states_snd',sound=True)"
usage: music_capture.py ROM [seconds] [first last]"""
import os, sys, wave
import numpy as np
sys.path.insert(0, 'src')
from ffl2kster.emu import Emulator
ROM = sys.argv[1]
secs = float(sys.argv[2]) if len(sys.argv) > 2 else 90
a, b = (int(sys.argv[3]), int(sys.argv[4])) if len(sys.argv) > 4 else (1, 19)
os.makedirs('build/audio', exist_ok=True)
for song in range(a, b + 1):
    with Emulator(ROM, sound=True) as e:
        e.load_state('build/states_snd/first_town.state'); pb = e.pb
        pb.memory[0xFFB0] = 0; pb.tick(30, True, True)      # silence first
        pb.memory[0xFFB0] = song
        chunks = []
        for f in range(int(secs * 59.7275)):
            pb.tick(1, True, True); chunks.append(pb.sound.ndarray.copy())
        st = np.concatenate(chunks).astype(np.int32)
        mono = st.mean(axis=1)                               # downmix
        mono = mono[: len(mono) // 2 * 2].reshape(-1, 2).mean(axis=1)   # 48k -> 24k
        pcm = (mono * 256).clip(-32768, 32767).astype(np.int16)
        with wave.open(f'build/audio/song_{song:02d}.wav', 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(pb.sound.sample_rate // 2)
            w.writeframes(pcm.tobytes())
        print(f'song {song:2d}: {len(pcm)/(pb.sound.sample_rate//2):.1f}s rms {np.sqrt((pcm.astype(np.float64)**2).mean()):.0f} current={pb.memory[0xFFB3]}')
