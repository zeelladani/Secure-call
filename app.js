// Theme toggle functionality
const themeToggle = document.getElementById('theme-toggle');
const themeIcon = document.getElementById('theme-icon');

// Check for saved theme preference or default to light
const savedTheme = localStorage.getItem('theme') || 'light';
document.body.classList.toggle('dark', savedTheme === 'dark');
updateThemeIcon();

themeToggle.addEventListener('click', () => {
  document.body.classList.toggle('dark');
  const isDark = document.body.classList.contains('dark');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  updateThemeIcon();
});

function updateThemeIcon() {
  const isDark = document.body.classList.contains('dark');
  themeIcon.textContent = isDark ? '☀️' : '🌙';
}

// DOM Elements
const setupScreen = document.getElementById('setup-screen');
const roomScreen = document.getElementById('room-screen');
const joinScreen = document.getElementById('join-screen');
const roomCodeDisplay = document.getElementById('room-code');
const connectionStatus = document.getElementById('connection-status');
const participantsList = document.getElementById('participants-list');
const createRoomBtn = document.getElementById('create-room-btn');
const joinRoomBtn = document.getElementById('join-room-btn');
const joinSubmitBtn = document.getElementById('join-submit-btn');
const backToSetupBtn = document.getElementById('back-to-setup');
const endCallBtn = document.getElementById('end-call-btn');
const muteBtn = document.getElementById('mute-btn');
const callTimer = document.getElementById('call-timer');
const callControls = document.querySelector('.call-controls');

// App state
let localStream = null;
let peerConnections = new Map();
let roomId = null;
let userId = null;
let userName = '';
let isRoomCreator = false;
let callStartTime = null;
let timerInterval = null;
let callActive = false;
let isMuted = false;
let pendingAnswers = new Map();
let userStatus = 'online'; // online, away
let visibilityCheckInterval = null;

// WebRTC configuration
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// Generate unique user ID
function generateUserId() {
    return 'user_' + Math.random().toString(36).substr(2, 9);
}

// Generate a random 4-digit room ID
function generateRoomId() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

// Initialize local audio stream
async function initializeLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            } 
        });
        console.log('✅ Local stream initialized with tracks:', localStream.getAudioTracks().length);
        return localStream;
    } catch (error) {
        console.error('❌ Error accessing microphone:', error);
        alert('Error accessing microphone. Please ensure you have allowed microphone access.');
        throw error;
    }
}

// Create room in Firebase
async function createRoom() {
    const roomRef = db.collection('rooms').doc(roomId);
    await roomRef.set({
        creatorId: userId,
        creatorName: userName,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        participantCount: 1,
        maxParticipants: 5,
        isActive: true
    });

    const participantRef = roomRef.collection('participants').doc(userId);
    await participantRef.set({
        userId: userId,
        userName: userName,
        joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
        isOnline: true,
        isCreator: true,
        status: 'online',
        lastSeen: firebase.firestore.FieldValue.serverTimestamp()
    });

    console.log('✅ Room created successfully');
}

// Join existing room
async function joinRoom() {
    const roomRef = db.collection('rooms').doc(roomId);
    
    try {
        const roomSnap = await roomRef.get();
        
        if (!roomSnap.exists) {
            throw new Error('Room does not exist');
        }

        const roomData = roomSnap.data();
        if (!roomData.isActive) {
            throw new Error('Call has ended');
        }

        if (roomData.participantCount >= roomData.maxParticipants) {
            throw new Error('Room is full');
        }

        // Add participant
        const participantRef = roomRef.collection('participants').doc(userId);
        await participantRef.set({
            userId: userId,
            userName: userName,
            joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
            isOnline: true,
            isCreator: false,
            status: 'online',
            lastSeen: firebase.firestore.FieldValue.serverTimestamp()
        });

        // Update participant count
        await roomRef.update({
            participantCount: firebase.firestore.FieldValue.increment(1)
        });

        console.log('✅ Joined room successfully');
        
    } catch (error) {
        console.error('❌ Error joining room:', error);
        throw error;
    }
}

// Update user status
async function updateUserStatus(status) {
    if (!roomId || !userId) return;
    
    try {
        const participantRef = db.collection('rooms').doc(roomId).collection('participants').doc(userId);
        await participantRef.update({
            status: status,
            lastSeen: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        userStatus = status;
        console.log(`🟡 User status updated to: ${status}`);
    } catch (error) {
        console.error('❌ Error updating user status:', error);
    }
}

// Setup visibility change listener
function setupVisibilityListener() {
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            // User switched to another tab or minimized browser
            updateUserStatus('away');
        } else {
            // User returned to the tab
            updateUserStatus('online');
        }
    });

    // Also update status periodically to ensure it's current
    visibilityCheckInterval = setInterval(() => {
        if (roomId && userId && userStatus === 'online') {
            updateUserStatus('online'); // This updates lastSeen timestamp
        }
    }, 30000); // Update every 30 seconds
}

// Listen for participants and host status
function listenForParticipants() {
    const participantsRef = db.collection('rooms').doc(roomId).collection('participants');
    
    participantsRef.onSnapshot((snapshot) => {
        const currentParticipants = new Map();
        let onlineCount = 0;
        let hostIsOnline = false;
        let totalParticipants = 0;
        
        snapshot.forEach(doc => {
            const participant = doc.data();
            currentParticipants.set(participant.userId, participant);
            totalParticipants++;
            
            if (participant.isOnline) {
                onlineCount++;
                console.log(`✅ Online: ${participant.userName} (${participant.userId})`);
            } else {
                console.log(`❌ Offline: ${participant.userName} (${participant.userId}) - will be hidden from list`);
            }
            
            if (participant.isCreator && participant.isOnline) {
                hostIsOnline = true;
            }
        });

        console.log(`📊 Participants summary: ${onlineCount} online / ${totalParticipants} total`);
        
        updateParticipantsUI(currentParticipants);
        updateConnectionStatus(onlineCount);

        // Handle new participants
        for (const [participantId, participant] of currentParticipants) {
            if (participantId !== userId && !peerConnections.has(participantId) && participant.isOnline) {
                console.log('👥 New participant detected:', participantId);
                setupPeerConnection(participantId);
            }
        }

        // Handle disconnected participants
        for (const [participantId] of peerConnections) {
            if (!currentParticipants.has(participantId)) {
                console.log('👋 Participant completely removed from room:', participantId);
                closePeerConnection(participantId);
            } else {
                const participant = currentParticipants.get(participantId);
                if (!participant.isOnline) {
                    console.log('👋 Participant went offline:', participantId);
                    closePeerConnection(participantId);
                }
            }
        }

        // Check if host left the call
        if (!hostIsOnline && !isRoomCreator && callActive) {
            console.log('👑 Host left the call - ending session for all');
            endCallDueToHostLeave();
            return;
        }

        // Auto-end call if only one participant remains
        if (onlineCount <= 1 && callActive) {
            console.log('🔚 Only one participant left, ending call');
            endCall();
        }
    });

    // Listen for room status
    const roomRef = db.collection('rooms').doc(roomId);
    roomRef.onSnapshot((docSnap) => {
        if (docSnap.exists) {
            const roomData = docSnap.data();
            if (!roomData.isActive && callActive) {
                console.log('🔚 Room ended remotely');
                endCall(true);
            }
        }
    });

    // Listen for host leave events
    const hostLeaveEventsRef = db.collection('rooms').doc(roomId).collection('hostLeaveEvents');
    hostLeaveEventsRef.onSnapshot((snapshot) => {
        snapshot.docChanges().forEach(change => {
            if (change.type === 'added' && !isRoomCreator) {
                const data = change.doc.data();
                console.log('👑 Host ended the call for all participants');
                
                // Clean up the event
                change.doc.ref.delete().catch(e => console.log('Cleanup error:', e));
                
                // End call due to host leave
                setTimeout(() => {
                    endCallDueToHostLeave();
                }, 100);
            }
        });
    });

    // Listen for kick events
    const kickEventsRef = db.collection('rooms').doc(roomId).collection('kickEvents');
    kickEventsRef.where('targetUserId', '==', userId)
        .onSnapshot((snapshot) => {
            snapshot.docChanges().forEach(change => {
                if (change.type === 'added') {
                    const data = change.doc.data();
                    console.log('🚪 You have been kicked from the room by:', data.kickedBy);
                    
                    // Clean up the kick event first
                    change.doc.ref.delete().catch(e => console.log('Cleanup error:', e));
                    
                    // Use setTimeout to ensure clean execution
                    setTimeout(() => {
                        alert('You have been removed from the call by the host.');
                        forceResetToMainPage();
                    }, 100);
                }
            });
        });

    // Setup signaling listeners
    setupSignaling();
}

// End call when host leaves (for participants)
function endCallDueToHostLeave() {
    console.log('👑 Host ended the call - redirecting to main page');
    
    // Stop all media streams aggressively
    if (localStream) {
        localStream.getTracks().forEach(track => {
            track.stop();
            track.enabled = false;
        });
        localStream = null;
    }
    
    // Close all peer connections aggressively
    peerConnections.forEach((connection, participantId) => {
        try {
            connection.getSenders().forEach(sender => {
                if (sender.track) {
                    sender.track.stop();
                }
            });
            connection.close();
        } catch (e) {
            console.log('Error closing connection:', e);
        }
    });
    peerConnections.clear();
    
    // Clear all intervals
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    if (visibilityCheckInterval) {
        clearInterval(visibilityCheckInterval);
        visibilityCheckInterval = null;
    }
    
    // Clear pending answers
    pendingAnswers.clear();
    
    // Reset all state variables
    roomId = null;
    userId = null;
    userName = '';
    isRoomCreator = false;
    callStartTime = null;
    callActive = false;
    isMuted = false;
    userStatus = 'online';
    
    // Update UI to show main page immediately
    callControls.classList.add('hidden');
    
    const cancelBtn = document.getElementById('cancel-room-btn');
    if (cancelBtn) {
        cancelBtn.classList.add('hidden');
    }
    
    setupScreen.classList.remove('hidden');
    roomScreen.classList.add('hidden');
    joinScreen.classList.add('hidden');
    
    // Reset form fields
    document.getElementById('name').value = '';
    document.getElementById('join-code').value = '';
    document.getElementById('join-name').value = '';
    
    // Show message to user
    alert('The host has ended the call. Returning to main page.');
    
    console.log('✅ Call ended due to host leave - returned to main page');
}

// Force reset to main page (for kicked users)
function forceResetToMainPage() {
    console.log('🔄 Force resetting to main page...');
    
    // Stop all media streams aggressively
    if (localStream) {
        localStream.getTracks().forEach(track => {
            track.stop();
            track.enabled = false;
        });
        localStream = null;
    }
    
    // Close all peer connections aggressively
    peerConnections.forEach((connection, participantId) => {
        try {
            connection.getSenders().forEach(sender => {
                if (sender.track) {
                    sender.track.stop();
                }
            });
            connection.close();
        } catch (e) {
            console.log('Error closing connection:', e);
        }
    });
    peerConnections.clear();
    
    // Clear all intervals
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    if (visibilityCheckInterval) {
        clearInterval(visibilityCheckInterval);
        visibilityCheckInterval = null;
    }
    
    // Clear pending answers
    pendingAnswers.clear();
    
    // Reset all state variables
    roomId = null;
    userId = null;
    userName = '';
    isRoomCreator = false;
    callStartTime = null;
    callActive = false;
    isMuted = false;
    userStatus = 'online';
    
    // Update UI to show main page immediately
    callControls.classList.add('hidden');
    
    const cancelBtn = document.getElementById('cancel-room-btn');
    if (cancelBtn) {
        cancelBtn.classList.add('hidden');
    }
    
    setupScreen.classList.remove('hidden');
    roomScreen.classList.add('hidden');
    joinScreen.classList.add('hidden');
    
    // Reset form fields
    document.getElementById('name').value = '';
    document.getElementById('join-code').value = '';
    document.getElementById('join-name').value = '';
    
    console.log('✅ Completely reset to main page');
}

// Kick user from room (host only)
async function kickUser(targetUserId) {
    if (!isRoomCreator) {
        console.log('❌ Only room creator can kick users');
        return;
    }

    try {
        // Add kick event
        await db.collection('rooms').doc(roomId).collection('kickEvents').add({
            targetUserId: targetUserId,
            kickedBy: userId,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        // Update participant status to offline immediately
        const participantRef = db.collection('rooms').doc(roomId).collection('participants').doc(targetUserId);
        await participantRef.update({
            isOnline: false,
            status: 'kicked',
            leftAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        console.log(`🚪 Kicked user: ${targetUserId}`);

        // Close the peer connection immediately
        closePeerConnection(targetUserId);

        // Update participant count
        const roomRef = db.collection('rooms').doc(roomId);
        const roomSnap = await roomRef.get();
        if (roomSnap.exists) {
            const roomData = roomSnap.data();
            await roomRef.update({
                participantCount: Math.max(0, roomData.participantCount - 1)
            });
        }

        // Force immediate UI update
        setTimeout(() => {
            const participantsRef = db.collection('rooms').doc(roomId).collection('participants');
            participantsRef.get().then(snapshot => {
                const currentParticipants = new Map();
                snapshot.forEach(doc => {
                    const participant = doc.data();
                    currentParticipants.set(participant.userId, participant);
                });
                updateParticipantsUI(currentParticipants);
            });
        }, 100);

    } catch (error) {
        console.error('❌ Error kicking user:', error);
    }
}

// Cancel room (host only during waiting)
async function cancelRoom() {
    if (!isRoomCreator) {
        console.log('❌ Only room creator can cancel the room');
        return;
    }

    try {
        const roomRef = db.collection('rooms').doc(roomId);
        
        // Mark room as inactive
        await roomRef.update({
            isActive: false,
            endedAt: firebase.firestore.FieldValue.serverTimestamp(),
            cancelled: true
        });

        // Add host leave event to notify all participants
        await db.collection('rooms').doc(roomId).collection('hostLeaveEvents').add({
            hostId: userId,
            hostName: userName,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            reason: 'cancelled'
        });

        console.log('🚫 Room cancelled by host');
        resetToSetup();

    } catch (error) {
        console.error('❌ Error cancelling room:', error);
    }
}

// Setup WebRTC signaling
function setupSignaling() {
    // Listen for offers
    db.collection('rooms').doc(roomId).collection('offers')
        .where('to', '==', userId)
        .onSnapshot(async (snapshot) => {
            snapshot.docChanges().forEach(async (change) => {
                if (change.type === 'added') {
                    const data = change.doc.data();
                    console.log('📨 Received offer from:', data.from);
                    await handleOffer(data.from, data.offer);
                    // Clean up the offer
                    change.doc.ref.delete().catch(e => console.log('Cleanup error:', e));
                }
            });
        });

    // Listen for answers
    db.collection('rooms').doc(roomId).collection('answers')
        .where('to', '==', userId)
        .onSnapshot(async (snapshot) => {
            snapshot.docChanges().forEach(async (change) => {
                if (change.type === 'added') {
                    const data = change.doc.data();
                    console.log('📨 Received answer from:', data.from);
                    await handleAnswer(data.from, data.answer);
                    // Clean up the answer
                    change.doc.ref.delete().catch(e => console.log('Cleanup error:', e));
                }
            });
        });

    // Listen for ICE candidates
    db.collection('rooms').doc(roomId).collection('candidates')
        .where('to', '==', userId)
        .onSnapshot((snapshot) => {
            snapshot.docChanges().forEach(async (change) => {
                if (change.type === 'added') {
                    const data = change.doc.data();
                    console.log('📨 Received ICE candidate from:', data.from);
                    await handleIceCandidate(data.from, data.candidate);
                    // Clean up the candidate
                    change.doc.ref.delete().catch(e => console.log('Cleanup error:', e));
                }
            });
        });
}

// Setup peer connection
async function setupPeerConnection(participantId) {
    console.log('🔗 Setting up peer connection with:', participantId);
    
    try {
        const peerConnection = new RTCPeerConnection(configuration);
        peerConnections.set(participantId, peerConnection);

        // Add local stream
        localStream.getTracks().forEach(track => {
            console.log('🎤 Adding local track:', track.kind);
            peerConnection.addTrack(track, localStream);
        });

        // Handle incoming stream
        peerConnection.ontrack = (event) => {
            console.log('🎧 Received remote stream from:', participantId);
            const remoteStream = event.streams[0];
            
            // Create audio element for remote audio
            const audio = document.createElement('audio');
            audio.srcObject = remoteStream;
            audio.autoplay = true;
            audio.controls = false;
            audio.style.display = 'none';
            
            // Add to page
            document.body.appendChild(audio);
            
            console.log('✅ Remote audio setup complete for:', participantId);
            
            // Test if audio is working
            audio.onloadedmetadata = () => {
                console.log('🔊 Remote audio metadata loaded');
            };
            
            audio.onplay = () => {
                console.log('▶️ Remote audio started playing');
            };

            audio.onerror = (error) => {
                console.error('❌ Remote audio error:', error);
            };
        };

        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('❄️ Sending ICE candidate to:', participantId);
                
                // Convert RTCIceCandidate to plain object for Firebase
                const candidateData = {
                    candidate: event.candidate.candidate,
                    sdpMid: event.candidate.sdpMid,
                    sdpMLineIndex: event.candidate.sdpMLineIndex,
                    usernameFragment: event.candidate.usernameFragment
                };
                
                db.collection('rooms').doc(roomId).collection('candidates').add({
                    from: userId,
                    to: participantId,
                    candidate: candidateData,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                }).catch(error => {
                    console.error('❌ Error sending ICE candidate:', error);
                });
            }
        };

        // Handle connection state
        peerConnection.onconnectionstatechange = () => {
            const state = peerConnection.connectionState;
            console.log(`🔗 Connection state with ${participantId}:`, state);
            
            if (state === 'connected') {
                console.log('✅ Successfully connected to:', participantId);
                // Try to process any pending answers
                processPendingAnswer(participantId);
            } else if (state === 'failed' || state === 'disconnected') {
                console.log('❌ Connection failed with:', participantId);
            }
        };

        // Handle ICE connection state
        peerConnection.oniceconnectionstatechange = () => {
            console.log(`❄️ ICE connection state with ${participantId}:`, peerConnection.iceConnectionState);
        };

        // Create offer if we should initiate
        if (isRoomCreator || userId > participantId) {
            console.log('📤 Creating offer for:', participantId);
            await createOffer(participantId, peerConnection);
        }

    } catch (error) {
        console.error('❌ Error setting up peer connection:', error);
    }
}

// Create and send offer
async function createOffer(participantId, peerConnection) {
    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        console.log('📤 Sending offer to:', participantId);
        await db.collection('rooms').doc(roomId).collection('offers').add({
            from: userId,
            to: participantId,
            offer: offer,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        
    } catch (error) {
        console.error('❌ Error creating offer:', error);
    }
}

// Handle incoming offer
async function handleOffer(fromParticipantId, offer) {
    try {
        console.log('📥 Handling offer from:', fromParticipantId);
        
        let peerConnection = peerConnections.get(fromParticipantId);
        if (!peerConnection) {
            console.log('🔗 Creating new peer connection for offer from:', fromParticipantId);
            peerConnection = new RTCPeerConnection(configuration);
            peerConnections.set(fromParticipantId, peerConnection);

            // Add local stream
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
            });

            // Handle incoming stream
            peerConnection.ontrack = (event) => {
                console.log('🎧 Received remote stream in handleOffer from:', fromParticipantId);
                const remoteStream = event.streams[0];
                
                const audio = document.createElement('audio');
                audio.srcObject = remoteStream;
                audio.autoplay = true;
                audio.controls = false;
                audio.style.display = 'none';
                document.body.appendChild(audio);
                
                console.log('✅ Remote audio setup in handleOffer for:', fromParticipantId);
            };

            // Handle ICE candidates
            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    console.log('❄️ Sending ICE candidate to:', fromParticipantId);
                    
                    const candidateData = {
                        candidate: event.candidate.candidate,
                        sdpMid: event.candidate.sdpMid,
                        sdpMLineIndex: event.candidate.sdpMLineIndex,
                        usernameFragment: event.candidate.usernameFragment
                    };
                    
                    db.collection('rooms').doc(roomId).collection('candidates').add({
                        from: userId,
                        to: fromParticipantId,
                        candidate: candidateData,
                        timestamp: firebase.firestore.FieldValue.serverTimestamp()
                    }).catch(error => {
                        console.error('❌ Error sending ICE candidate:', error);
                    });
                }
            };

            // Handle connection state for new peer connection
            peerConnection.onconnectionstatechange = () => {
                const state = peerConnection.connectionState;
                console.log(`🔗 Connection state with ${fromParticipantId}:`, state);
                
                if (state === 'connected') {
                    console.log('✅ Successfully connected to:', fromParticipantId);
                    processPendingAnswer(fromParticipantId);
                }
            };
        }

        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        console.log('✅ Set remote description for:', fromParticipantId);

        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        console.log('✅ Created answer for:', fromParticipantId);

        await db.collection('rooms').doc(roomId).collection('answers').add({
            from: userId,
            to: fromParticipantId,
            answer: answer,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        console.log('📤 Sent answer to:', fromParticipantId);

    } catch (error) {
        console.error('❌ Error handling offer:', error);
    }
}

// Handle incoming answer
async function handleAnswer(fromParticipantId, answer) {
    try {
        console.log('📥 Handling answer from:', fromParticipantId);
        const peerConnection = peerConnections.get(fromParticipantId);
        
        if (peerConnection) {
            // Store the answer if we're not ready to process it yet
            if (peerConnection.signalingState !== 'have-local-offer') {
                console.log('💾 Storing answer for later processing, current state:', peerConnection.signalingState);
                pendingAnswers.set(fromParticipantId, answer);
                return;
            }

            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            console.log('✅ Set remote description from answer for:', fromParticipantId);
        } else {
            console.log('❌ No peer connection found for:', fromParticipantId);
        }
    } catch (error) {
        console.error('❌ Error handling answer:', error);
        // Store for retry later
        pendingAnswers.set(fromParticipantId, answer);
    }
}

// Process pending answers when connection is ready
function processPendingAnswer(participantId) {
    const pendingAnswer = pendingAnswers.get(participantId);
    if (pendingAnswer) {
        console.log('🔄 Processing pending answer for:', participantId);
        pendingAnswers.delete(participantId);
        handleAnswer(participantId, pendingAnswer);
    }
}

// Handle ICE candidate
async function handleIceCandidate(fromParticipantId, candidateData) {
    try {
        console.log('📥 Handling ICE candidate from:', fromParticipantId);
        const peerConnection = peerConnections.get(fromParticipantId);
        if (peerConnection && candidateData) {
            // Recreate RTCIceCandidate from plain object
            const candidate = new RTCIceCandidate({
                candidate: candidateData.candidate,
                sdpMid: candidateData.sdpMid,
                sdpMLineIndex: candidateData.sdpMLineIndex,
                usernameFragment: candidateData.usernameFragment
            });
            
            await peerConnection.addIceCandidate(candidate);
            console.log('✅ Added ICE candidate from:', fromParticipantId);
        }
    } catch (error) {
        console.error('❌ Error handling ICE candidate:', error);
    }
}

// Close peer connection
function closePeerConnection(participantId) {
    const peerConnection = peerConnections.get(participantId);
    if (peerConnection) {
        try {
            peerConnection.getSenders().forEach(sender => {
                if (sender.track) {
                    sender.track.stop();
                }
            });
            peerConnection.close();
        } catch (e) {
            console.log('Error closing peer connection:', e);
        }
        peerConnections.delete(participantId);
        pendingAnswers.delete(participantId);
        console.log('🔚 Closed connection with:', participantId);
    }
}

// Update participants UI with status indicators - ONLY SHOW ONLINE USERS
function updateParticipantsUI(currentParticipants) {
    participantsList.innerHTML = '';
    
    currentParticipants.forEach((participant, participantId) => {
        // Only show participants who are currently online
        if (!participant.isOnline) {
            console.log(`👋 Skipping offline participant: ${participant.userName}`);
            return; // Skip this participant
        }
        
        const participantEl = document.createElement('div');
        participantEl.className = `participant ${participantId === userId ? 'participant-you' : ''}`;
        
        // Status indicator
        let statusIndicator = '';
        let statusText = '';
        
        if (participant.status === 'online') {
            statusIndicator = '<span class="status-indicator online"></span>';
            statusText = 'Online';
        } else if (participant.status === 'away') {
            statusIndicator = '<span class="status-indicator away"></span>';
            statusText = 'Away';
        } else if (participant.status === 'kicked') {
            statusIndicator = '<span class="status-indicator offline"></span>';
            statusText = 'Removed';
        } else {
            statusIndicator = '<span class="status-indicator offline"></span>';
            statusText = 'Offline';
        }
        
        // Crown icon for host
        const hostIcon = participant.isCreator ? '👑 ' : '';
        
        // Kick button for host (only for other participants)
        let kickButton = '';
        if (isRoomCreator && participantId !== userId && participant.isOnline) {
            kickButton = `<button class="kick-btn" onclick="kickUser('${participantId}')" title="Remove participant">🚫</button>`;
        }
        
        participantEl.innerHTML = `
            <div class="participant-avatar">${participant.userName.charAt(0).toUpperCase()}</div>
            <div class="participant-name">${hostIcon}${participant.userName} ${participantId === userId ? '(You)' : ''}</div>
            <div class="participant-status">
                ${statusIndicator} ${statusText}
            </div>
            ${kickButton}
        `;
        
        participantsList.appendChild(participantEl);
    });

    // Log for debugging
    console.log(`👥 Updated participants list: ${participantsList.children.length} online participants`);
}

// Update connection status and show/hide cancel button
function updateConnectionStatus(onlineCount) {
    const cancelBtn = document.getElementById('cancel-room-btn');
    
    if (onlineCount === 1) {
        connectionStatus.innerHTML = '<span class="loading"></span> Waiting for other participants...';
        connectionStatus.className = 'status waiting';
        callControls.classList.add('hidden');
        
        // Show cancel button for host when waiting
        if (isRoomCreator && cancelBtn) {
            cancelBtn.classList.remove('hidden');
        }
        
        callActive = false;
        if (timerInterval) {
            clearInterval(timerInterval);
        }
    } else if (onlineCount > 1) {
        connectionStatus.textContent = `Connected with ${onlineCount - 1} participant(s)`;
        connectionStatus.className = 'status connected';
        callControls.classList.remove('hidden');
        
        // Hide cancel button when call is active
        if (cancelBtn) {
            cancelBtn.classList.add('hidden');
        }
        
        if (!callActive) {
            callActive = true;
            startCallTimer();
        }
    }
}

// Start call timer
function startCallTimer() {
    callStartTime = new Date();
    updateCallTimer();
    timerInterval = setInterval(updateCallTimer, 1000);
}

// Update call timer
function updateCallTimer() {
    if (callStartTime) {
        const now = new Date();
        const diff = Math.floor((now - callStartTime) / 1000);
        const minutes = Math.floor(diff / 60).toString().padStart(2, '0');
        const seconds = (diff % 60).toString().padStart(2, '0');
        callTimer.textContent = `${minutes}:${seconds}`;
    }
}

// Toggle mute
function toggleMute() {
    if (localStream) {
        const audioTracks = localStream.getAudioTracks();
        audioTracks.forEach(track => {
            track.enabled = isMuted;
        });
        isMuted = !isMuted;
        muteBtn.textContent = isMuted ? 'Unmute' : 'Mute';
        console.log('🎤 Microphone', isMuted ? 'muted' : 'unmuted');
    }
}

// End call (for host - ends call for everyone)
async function endCall(remoteEnd = false) {
    console.log('🔚 Ending call, remoteEnd:', remoteEnd);
    
    callActive = false;
    
    if (timerInterval) {
        clearInterval(timerInterval);
    }
    
    if (visibilityCheckInterval) {
        clearInterval(visibilityCheckInterval);
    }
    
    // Close all peer connections
    peerConnections.forEach((connection, participantId) => {
        closePeerConnection(participantId);
    });
    
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    
    // Update Firebase - if host is ending call, notify all participants
    if (roomId && userId) {
        try {
            // Update participant status
            const participantRef = db.collection('rooms').doc(roomId).collection('participants').doc(userId);
            await participantRef.update({
                isOnline: false,
                status: 'offline',
                leftAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            const roomRef = db.collection('rooms').doc(roomId);
            const roomSnap = await roomRef.get();
            
            if (roomSnap.exists) {
                const roomData = roomSnap.data();
                const newCount = roomData.participantCount - 1;
                
                if (newCount <= 0 || isRoomCreator) {
                    // Host is leaving - end the call for everyone
                    await roomRef.update({
                        isActive: false,
                        endedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });

                    // Notify all participants that host ended the call
                    if (isRoomCreator && !remoteEnd) {
                        await db.collection('rooms').doc(roomId).collection('hostLeaveEvents').add({
                            hostId: userId,
                            hostName: userName,
                            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                            reason: 'ended'
                        });
                    }
                } else {
                    await roomRef.update({
                        participantCount: newCount
                    });
                }
            }
        } catch (e) {
            console.error("❌ Error updating call end status:", e);
        }
    }
    
    resetToSetup();
}

// Reset to setup screen
function resetToSetup() {
    callControls.classList.add('hidden');
    
    // Hide cancel button safely
    const cancelBtn = document.getElementById('cancel-room-btn');
    if (cancelBtn) {
        cancelBtn.classList.add('hidden');
    }
    
    setupScreen.classList.remove('hidden');
    roomScreen.classList.add('hidden');
    joinScreen.classList.add('hidden');
    
    document.getElementById('name').value = '';
    document.getElementById('join-code').value = '';
    document.getElementById('join-name').value = '';
    
    localStream = null;
    peerConnections.clear();
    pendingAnswers.clear();
    roomId = null;
    userId = null;
    userName = '';
    isRoomCreator = false;
    callStartTime = null;
    isMuted = false;
    muteBtn.textContent = 'Mute';
    userStatus = 'online';
    
    if (visibilityCheckInterval) {
        clearInterval(visibilityCheckInterval);
        visibilityCheckInterval = null;
    }
}

// Debug function to check participant status
window.debugParticipants = function() {
    if (!roomId) {
        console.log('❌ No active room');
        return;
    }
    
    const participantsRef = db.collection('rooms').doc(roomId).collection('participants');
    participantsRef.get().then(snapshot => {
        console.log('🔍 DEBUG - All Participants in Firestore:');
        snapshot.forEach(doc => {
            const participant = doc.data();
            console.log(`- ${participant.userName} (${participant.userId}):`, {
                isOnline: participant.isOnline,
                status: participant.status,
                isCreator: participant.isCreator
            });
        });
    });
};

// Force refresh participants list
window.refreshParticipants = function() {
    if (!roomId) {
        console.log('❌ No active room');
        return;
    }
    
    const participantsRef = db.collection('rooms').doc(roomId).collection('participants');
    participantsRef.get().then(snapshot => {
        const currentParticipants = new Map();
        snapshot.forEach(doc => {
            const participant = doc.data();
            currentParticipants.set(participant.userId, participant);
        });
        updateParticipantsUI(currentParticipants);
        console.log('🔄 Manually refreshed participants list');
    });
};

// Event Listeners
createRoomBtn.addEventListener('click', async () => {
    const nameInput = document.getElementById('name');
    if (!nameInput.value.trim()) {
        alert('Please enter your name');
        return;
    }
    
    userName = nameInput.value.trim();
    userId = generateUserId();
    roomId = generateRoomId();
    isRoomCreator = true;
    
    console.log('🚀 Creating room:', roomId, 'User:', userId);
    
    setupScreen.classList.add('hidden');
    roomScreen.classList.remove('hidden');
    roomCodeDisplay.textContent = roomId;
    connectionStatus.innerHTML = '<span class="loading"></span> Creating room...';
    connectionStatus.className = 'status connecting';
    
    try {
        await initializeLocalStream();
        await createRoom();
        setupVisibilityListener();
        listenForParticipants();
    } catch (error) {
        console.error('❌ Error creating room:', error);
        alert('Error creating room: ' + error.message);
        resetToSetup();
    }
});

joinRoomBtn.addEventListener('click', () => {
    setupScreen.classList.add('hidden');
    joinScreen.classList.remove('hidden');
});

joinSubmitBtn.addEventListener('click', async () => {
    const codeInput = document.getElementById('join-code');
    const nameInput = document.getElementById('join-name');
    
    if (!codeInput.value.trim() || codeInput.value.length !== 4) {
        alert('Please enter a valid 4-digit room code');
        return;
    }
    
    if (!nameInput.value.trim()) {
        alert('Please enter your name');
        return;
    }
    
    roomId = codeInput.value.trim();
    userName = nameInput.value.trim();
    userId = generateUserId();
    isRoomCreator = false;
    
    console.log('🚀 Joining room:', roomId, 'User:', userId);
    
    joinScreen.classList.add('hidden');
    roomScreen.classList.remove('hidden');
    roomCodeDisplay.textContent = roomId;
    connectionStatus.innerHTML = '<span class="loading"></span> Joining call...';
    connectionStatus.className = 'status connecting';
    
    try {
        await initializeLocalStream();
        await joinRoom();
        setupVisibilityListener();
        listenForParticipants();
    } catch (error) {
        console.error('❌ Error joining room:', error);
        alert('Error joining room: ' + error.message);
        resetToSetup();
    }
});

backToSetupBtn.addEventListener('click', () => {
    joinScreen.classList.add('hidden');
    setupScreen.classList.remove('hidden');
});

endCallBtn.addEventListener('click', () => {
    endCall();
});

muteBtn.addEventListener('click', () => {
    toggleMute();
});

// Handle page unload
window.addEventListener('beforeunload', () => {
    if (callActive) {
        endCall();
    }
});

// Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                console.log('✅ SW registered: ', registration);
            })
            .catch(registrationError => {
                console.log('❌ SW registration failed: ', registrationError);
            });
    });
}

// Make functions available globally
window.kickUser = kickUser;
window.cancelRoom = cancelRoom;
window.debugParticipants = debugParticipants;
window.refreshParticipants = refreshParticipants;

// Debug function to test audio
window.testAudio = function() {
    if (localStream) {
        const audio = document.createElement('audio');
        audio.srcObject = localStream;
        audio.autoplay = true;
        audio.controls = true;
        audio.style.position = 'fixed';
        audio.style.top = '10px';
        audio.style.right = '10px';
        audio.style.zIndex = '1000';
        document.body.appendChild(audio);
        console.log('🎧 Test audio element created');
    } else {
        console.log('❌ No local stream available for testing');
    }
};

// Check audio status
window.checkAudio = function() {
    console.log('🔍 Audio check:');
    console.log('- Local stream:', localStream ? '✅ Available' : '❌ Not available');
    console.log('- Peer connections:', peerConnections.size);
    
    peerConnections.forEach((pc, id) => {
        console.log(`- Connection ${id}:`, pc.connectionState, pc.iceConnectionState);
    });
    
    const audioElements = document.querySelectorAll('audio');
    console.log('- Audio elements:', audioElements.length);
    audioElements.forEach((audio, index) => {
        console.log(`  Audio ${index}:`, {
            srcObject: audio.srcObject ? '✅ Has stream' : '❌ No stream',
            paused: audio.paused,
            readyState: audio.readyState,
            error: audio.error
        });
    });
};