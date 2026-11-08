import asyncio
import json
import websockets

async def test():
    uri = 'ws://localhost:8000/ws/session'
    async with websockets.connect(uri) as ws:
        for i in range(3):
            await ws.send(json.dumps({
                'type': 'frame',
                't': 1730350000000 + i * 1000,
                'image_b64': 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
            }))
        print('Sent 3 frames successfully')
        
        await ws.send(json.dumps({
            'type': 'question',
            'text': 'What do you see?'
        }))
        print('Sent question. Awaiting stream...')
        
        tokens = []
        while True:
            resp = json.loads(await ws.recv())
            if resp['type'] == 'token':
                tokens.append(resp['text'])
            elif resp['type'] == 'done':
                print(f"Done received! TTFT: {resp.get('ttft_ms')}ms, Total: {resp.get('latency_ms')}ms")
                print("Streamed response:", "".join(tokens))
                break
            elif resp['type'] == 'error':
                print('Error:', resp)
                break

asyncio.run(test())
