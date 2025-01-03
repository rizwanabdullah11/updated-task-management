import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import Peer from 'simple-peer';
import { collection, addDoc, onSnapshot, query,orderBy, where, getDocs, updateDoc, limit, doc, getDoc } from 'firebase/firestore';
import { db } from '../Firebase';
import { PhoneIcon, PhoneXMarkIcon } from '@heroicons/react/24/solid';
import { Buffer } from 'buffer';
window.Buffer = Buffer;
window.process = require('process/browser');

const VideoCall = () => {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const currentUser = useSelector(state => state.auth.currentUser);
  const [stream, setStream] = useState(null);
  const [peer, setPeer] = useState(null);
  const [callCode, setCallCode] = useState('');
  const [isCallActive, setIsCallActive] = useState(false);
  const [connectionCode, setConnectionCode] = useState('');
  const [isInitiator, setIsInitiator] = useState(false);
  const [callStatus, setCallStatus] = useState('');
  const [showCodeInput, setShowCodeInput] = useState(true);
  const [callDuration, setCallDuration] = useState(0);
  const myVideo = useRef();
  const remoteVideo = useRef();
  const connectionRef = useRef();
  const timerRef = useRef();

  const startTimer = () => {
    timerRef.current = setInterval(() => {
      setCallDuration(prev => prev + 1);
    }, 1000);
  };

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const releaseMediaDevices = () => {
    if (stream) {
      stream.getTracks().forEach(track => {
        track.stop();
        stream.removeTrack(track);
      });
    }
  };

  const createCallSession = async (code, signalData) => {
    console.log('📞 Creating new call session:', code);
    await addDoc(collection(db, 'activeCalls'), {
      code,
      taskId,
      initiator: currentUser.userId,
      status: 'pending',
      createdAt: new Date().toISOString()
    });

    await addDoc(collection(db, 'calls'), {
      code,
      taskId,
      from: currentUser.userId,
      signalData,
      type: 'offer',
      timestamp: new Date().toISOString()
    });
  };

  const startCall = async () => {
    try {
      await releaseMediaDevices();
      console.log('🎥 Requesting media permissions...');
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: true, 
        audio: true 
      });
      console.log('✅ Media access granted');
      setStream(stream);
      myVideo.current.srcObject = stream;

      const newPeer = new Peer({
        initiator: true,
        trickle: false,
        stream,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        }
      });

      newPeer.on('signal', async (data) => {
        const code = Math.random().toString(36).substring(2);
        console.log('🔑 Generated call code:', code);
        setCallCode(code);
        await createCallSession(code, data);
      });

      newPeer.on('connect', () => {
        console.log('🤝 Peer connection established as initiator');
        setCallStatus('Connected');
        startTimer();
      });

      newPeer.on('stream', (remoteStream) => {
        console.log('📡 Received remote stream');
        remoteVideo.current.srcObject = remoteStream;
        setIsCallActive(true);
        setCallStatus('Connected');
      });

      setPeer(newPeer);
      connectionRef.current = newPeer;
      setIsInitiator(true);
    } catch (err) {
      console.error('❌ Error starting call:', err);
      setCallStatus('Failed to start call');
    }
  };

  const verifyAndJoinCall = async (code) => {
    console.log('🔍 Verifying call code:', code);
    try {
      const taskRef = doc(db, 'tasks', taskId);
      const taskDoc = await getDoc(taskRef);
      const taskData = taskDoc.data();

      const activeCallQuery = query(
        collection(db, 'activeCalls'),
        where('code', '==', code),
        where('status', '==', 'pending')
      );
      
      const snapshot = await getDocs(activeCallQuery);
      if (!snapshot.empty) {
        const callData = snapshot.docs[0].data();
        
        if (taskData.client === currentUser.id || taskData.assignee === currentUser.id) {
          console.log('✅ Call verified successfully');
          return true;
        }
      }
      
      setCallStatus('Invalid call code or verification failed');
      return false;
    } catch (error) {
      console.error('Error in verification:', error);
      return false;
    }
  };

  // Update the joinCall function to properly handle the remote connection
const joinCall = async () => {
  if (!await verifyAndJoinCall(connectionCode)) return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ 
      video: true, 
      audio: true 
    });
    setStream(stream);
    myVideo.current.srcObject = stream;

    const offerQuery = query(
      collection(db, 'calls'),
      where('code', '==', connectionCode),
      where('type', '==', 'offer'),
      orderBy('timestamp', 'desc'),
      limit(1)
    );

    const unsubscribe = onSnapshot(offerQuery, (snapshot) => {
      const offerData = snapshot.docs[0]?.data();
      if (!offerData) return;

      const newPeer = new Peer({
        initiator: false,
        trickle: false,
        stream,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' },
            {
              urls: 'turn:numb.viagenie.ca',
              username: 'webrtc@live.com',
              credential: 'muazkh'
            }
          ]
        }
      });

      newPeer.on('signal', async (signalData) => {
        await addDoc(collection(db, 'calls'), {
          code: connectionCode,
          taskId,
          from: currentUser.userId,
          signalData,
          type: 'answer',
          timestamp: new Date().toISOString()
        });
      });

      newPeer.on('stream', (remoteStream) => {
        if (remoteVideo.current) {
          remoteVideo.current.srcObject = remoteStream;
          setIsCallActive(true);
          setCallStatus('Connected');
          startTimer();
        }
      });

      newPeer.signal(offerData.signalData);
      setPeer(newPeer);
      connectionRef.current = newPeer;
    });

    return () => unsubscribe();
  } catch (err) {
    console.error('Error joining call:', err);
    setCallStatus('Failed to join call');
  }
};


  useEffect(() => {
    if (isInitiator && peer) {
      console.log('👂 Listening for answer signals');
      const answerQuery = query(
        collection(db, 'calls'),
        where('code', '==', callCode),
        where('type', '==', 'answer'),
        limit(1)
      );

      const unsubscribe = onSnapshot(answerQuery, (snapshot) => {
        snapshot.docs.forEach((doc) => {
          const data = doc.data();
          if (peer && data.from !== currentUser.userId) {
            console.log('📥 Processing answer signal');
            peer.signal(data.signalData);
          }
        });
      });

      return () => unsubscribe();
    }
  }, [isInitiator, peer, callCode, currentUser.userId]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      releaseMediaDevices();
    };
  }, []);

  const handleStartCall = async () => {
    setShowCodeInput(false);
    await startCall();
  };

  const handleJoinWithCode = async () => {
    if (!connectionCode) {
      setCallStatus('Please enter a call code');
      return;
    }
    setShowCodeInput(false);
    await joinCall();
  };

  const endCall = async () => {
    try {
      console.log('📴 Ending call');
      
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }

      releaseMediaDevices();
      connectionRef.current?.destroy();

      const code = callCode || connectionCode;
      const activeCallQuery = query(
        collection(db, 'activeCalls'),
        where('code', '==', code)
      );

      const snapshot = await getDocs(activeCallQuery);
      await Promise.all(
        snapshot.docs.map(doc => 
          updateDoc(doc.ref, { 
            status: 'ended',
            endedAt: new Date().toISOString()
          })
        )
      );

      setIsCallActive(false);
      setStream(null);
      setPeer(null);
      setCallCode('');
      setConnectionCode('');
      setIsInitiator(false);
      setCallStatus('');
      setCallDuration(0);
      
      if (myVideo.current) myVideo.current.srcObject = null;
      if (remoteVideo.current) remoteVideo.current.srcObject = null;
      
      navigate(`/dashboard/chat/${taskId}`);
      console.log('✅ Call ended successfully');
    } catch (error) {
      console.error('Error ending call:', error);
    }
  };

  return (
    <div className="h-screen bg-gray-900 flex flex-col items-center justify-center">
      {showCodeInput ? (
        <div className="bg-white p-8 rounded-lg shadow-xl w-96">
          <h2 className="text-2xl font-bold text-center mb-6">Video Call</h2>
          <div className="space-y-6">
            <button
              onClick={handleStartCall}
              className="w-full bg-green-500 hover:bg-green-600 text-white px-4 py-3 rounded-lg flex items-center justify-center gap-2"
            >
              <PhoneIcon className="h-5 w-5" />
              Start New Call
            </button>
            
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">Or join with code</span>
              </div>
            </div>

            <div className="space-y-3">
              <input
                type="text"
                value={connectionCode}
                onChange={(e) => setConnectionCode(e.target.value)}
                placeholder="Enter call code"
                className="w-full border-2 border-gray-200 p-3 rounded-lg focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={handleJoinWithCode}
                className="w-full bg-blue-500 hover:bg-blue-600 text-white px-4 py-3 rounded-lg flex items-center justify-center gap-2"
              >
                Join Call
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="relative">
              <video
                ref={myVideo}
                autoPlay
                muted
                playsInline
                className="w-full rounded-lg shadow-lg bg-gray-200"
              />
              <span className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded">
                You
              </span>
            </div>
            <div className="relative">
              <video
                ref={remoteVideo}
                autoPlay
                playsInline
                className="w-full rounded-lg shadow-lg bg-gray-200"
              />
              <span className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded">
                Remote User
              </span>
            </div>
          </div>

          {callStatus && (
            <div className={`text-sm mb-4 ${callStatus === 'Connected' ? 'text-green-500' : 'text-red-500'}`}>
              {callStatus}
            </div>
          )}

          {isCallActive && (
            <div className="text-white text-center mb-4">
              Call Duration: {formatDuration(callDuration)}
            </div>
          )}

          <div className="flex gap-4 items-center">
            <button
              onClick={endCall}
              className="bg-red-500 hover:bg-red-600 text-white px-6 py-3 rounded-lg flex items-center gap-2"
            >
              <PhoneXMarkIcon className="h-5 w-5" />
              End Call
            </button>
          </div>

          {callCode && isInitiator && (
            <div className="mt-4 p-4 bg-white rounded-lg shadow-md">
              <p className="text-center">Share this code with others to join:</p>
              <p className="text-xl font-bold text-center mt-2">{callCode}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default VideoCall;
