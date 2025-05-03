/**
 * @author Abhishek Bankar
 * @date 28th June, 2024
 */
import h from './helpers.js';

window.addEventListener('load', ()=>{
    const room = h.getQString(location.href, 'room');
    const username = sessionStorage.getItem('username');

    if(!room){
        document.querySelector('#room-create').attributes.removeNamedItem('hidden');
    }
    else if(!username){
        document.querySelector('#username-set').attributes.removeNamedItem('hidden');
    }
    else{
        let commElem = document.getElementsByClassName('room-comm');
        for(let i = 0; i < commElem.length; i++){
            commElem[i].attributes.removeNamedItem('hidden');
        }

        var pc = {}; // <-- FIXED: use object not array
        let socket = io('/stream');
        var socketId = '';
        var myStream = '';
        var screenStream = null;
        var isScreenSharing = false;

        socket.on('connect', ()=>{
            socketId = socket.io.engine.id;

            socket.emit('subscribe', {
                room: room,
                socketId: socketId
            });

            socket.on('new user', (data)=>{
                socket.emit('newUserStart', {to:data.socketId, sender:socketId});
                init(true, data.socketId);
            });

            socket.on('newUserStart', (data)=>{
                init(false, data.sender);
            });

            socket.on('ice candidates', async (data)=>{
                if (data.candidate && pc[data.sender]) {
                    await pc[data.sender].addIceCandidate(new RTCIceCandidate(data.candidate));
                }
            });

            socket.on('sdp', async (data)=>{
                if (data.description) {
                    if(data.description.type === 'offer'){
                        await pc[data.sender].setRemoteDescription(new RTCSessionDescription(data.description));
                        
                        h.getUserMedia().then(async (stream)=>{
                            // **DEBUG: Log track info**
                            console.log('SDP branch — got local media stream. AudioTracks:', stream.getAudioTracks());
                            console.log('SDP branch — got local media stream. VideoTracks:', stream.getVideoTracks());

                            if(!document.getElementById('local').srcObject){
                                document.getElementById('local').srcObject = stream;
                            }

                            myStream = stream;

                            stream.getTracks().forEach((track)=>{
                                pc[data.sender].addTrack(track, stream);
                            });

                            let answer = await pc[data.sender].createAnswer();
                            await pc[data.sender].setLocalDescription(answer);

                            socket.emit('sdp', {description:pc[data.sender].localDescription, to:data.sender, sender:socketId});
                        }).catch((e)=>{
                            console.error('Error obtaining local media in SDP handler:', e);
                        });
                    }
                    else if(data.description.type === 'answer'){
                        await pc[data.sender].setRemoteDescription(new RTCSessionDescription(data.description));
                    }
                }
            });

            socket.on('chat', (data)=>{
                h.addChat(data, 'remote');
            });
        });

        function sendMsg(msg){
            let data = {
                room: room,
                msg: msg,
                sender: username
            };

            socket.emit('chat', data);
            h.addChat(data, 'local');
        }

        function init(createOffer, partnerName){
            pc[partnerName] = new RTCPeerConnection(h.getIceServer());

            h.getUserMedia().then((stream)=>{
                // **DEBUG: Log track info**
                console.log('Init branch — got local media stream. AudioTracks:', stream.getAudioTracks());
                console.log('Init branch — got local media stream. VideoTracks:', stream.getVideoTracks());

                myStream = stream;

                stream.getTracks().forEach((track)=>{
                    pc[partnerName].addTrack(track, stream);
                });

                document.getElementById('local').srcObject = stream;
            }).catch((e)=>{
                console.error(`stream error in init(): ${e}`);
            });

            if(createOffer){
                pc[partnerName].onnegotiationneeded = async ()=>{
                    let offer = await pc[partnerName].createOffer();
                    await pc[partnerName].setLocalDescription(offer);

                    socket.emit('sdp', {description:pc[partnerName].localDescription, to:partnerName, sender:socketId});
                };
            }

            pc[partnerName].onicecandidate = ({candidate})=>{
                socket.emit('ice candidates', {candidate: candidate, to:partnerName, sender:socketId});
            };

            pc[partnerName].ontrack = (e)=>{
                let str = e.streams[0];
                if(document.getElementById(`${partnerName}-video`)){
                    document.getElementById(`${partnerName}-video`).srcObject = str;
                }
                else{
                    let newVid = document.createElement('video');
                    newVid.id = `${partnerName}-video`;
                    newVid.autoplay = true;
                    // **Ensure remote video is NOT muted**
                    // (no newVid.muted = true here)
                    newVid.srcObject = str;
                    newVid.className = 'remote-video';
                    
                    let cardDiv = document.createElement('div');
                    cardDiv.className = 'card mb-3';
                    cardDiv.appendChild(newVid);
                    
                    let div = document.createElement('div');
                    div.className = 'col-sm-12 col-md-6';
                    div.id = partnerName;
                    div.appendChild(cardDiv);
                    
                    document.getElementById('videos').appendChild(div);
                }
            };

            pc[partnerName].onconnectionstatechange = (d)=>{
                switch(pc[partnerName].iceConnectionState){
                    case 'disconnected':
                    case 'failed':
                    case 'closed':
                        h.closeVideo(partnerName);
                        break;
                }
            };

            pc[partnerName].onsignalingstatechange = (d)=>{
                switch(pc[partnerName].signalingState){
                    case 'closed':
                        console.log("Signalling state is 'closed'");
                        h.closeVideo(partnerName);
                        break;
                }
            };
        }

        document.getElementById('chat-input').addEventListener('keypress', (e)=>{
            if(e.which === 13 && (e.target.value.trim())){
                e.preventDefault();
                
                sendMsg(e.target.value);

                setTimeout(()=>{
                    e.target.value = '';
                }, 50);
            }
        });

        document.getElementById('toggle-video').addEventListener('click', (e)=>{
            e.preventDefault();

            myStream.getVideoTracks()[0].enabled = !(myStream.getVideoTracks()[0].enabled);

            e.target.classList.toggle('fa-video');
            e.target.classList.toggle('fa-video-slash');
        });

        document.getElementById('toggle-mute').addEventListener('click', (e)=>{
            e.preventDefault();

            myStream.getAudioTracks()[0].enabled = !(myStream.getAudioTracks()[0].enabled);

            e.target.classList.toggle('fa-volume-up');
            e.target.classList.toggle('fa-volume-mute');
        });

        // SCREEN SHARING
        document.getElementById('share-screen').addEventListener('click', async (e)=>{
            e.preventDefault();

            if (!isScreenSharing) {
                try {
                    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });

                    const screenTrack = screenStream.getTracks()[0];

                    for (let id in pc) {
                        let sender = pc[id].getSenders().find(s => s.track.kind === 'video');
                        if (sender) {
                            sender.replaceTrack(screenTrack);
                        }
                    }

                    screenTrack.onended = ()=>{
                        stopScreenSharing();
                    };

                    document.getElementById('local').srcObject = screenStream;
                    isScreenSharing = true;

                    document.getElementById('share-screen').hidden = true;
                    document.getElementById('stop-share').hidden = false;
                } catch (err) {
                    console.error('Screen sharing error:', err);
                }
            }
        });

        function stopScreenSharing(){
            if (screenStream) {
                let cameraTrack = myStream.getVideoTracks()[0];

                for (let id in pc) {
                    let sender = pc[id].getSenders().find(s => s.track.kind === 'video');
                    if (sender) {
                        sender.replaceTrack(cameraTrack);
                    }
                }

                screenStream.getTracks().forEach(track => track.stop());
                document.getElementById('local').srcObject = myStream;
                isScreenSharing = false;

                document.getElementById('share-screen').hidden = false;
                document.getElementById('stop-share').hidden = true;
            }
        }

        document.getElementById('stop-share').addEventListener('click', (e)=>{
            e.preventDefault();
            if (isScreenSharing) {
                stopScreenSharing();
            }
        });
    }
});
