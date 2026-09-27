import { randomUUID } from 'crypto';

import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { Repository } from 'typeorm';

import { Connection, ConnectionStatus } from '../connections/entities/connection.entity';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';

const MAX_SDP_LENGTH = 20000;
const MAX_ICE_CANDIDATE_LENGTH = 2000;
const MAX_SDP_MID_LENGTH = 64;

export type SessionDescription = {
  type: 'offer' | 'answer';
  sdp: string;
};

export type IceCandidate = {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
};

type CallState = 'ringing' | 'active';

type CallHistoryStatus = 'completed' | 'rejected' | 'missed';

type CallSession = {
  id: string;
  conversationId: string;
  callerId: string;
  recipientId: string;
  state: CallState;
  callerSocketId: string;
  acceptedRecipientSocketId: string | null;
  startedAt: Date | null;
};

export type CallLifecycleEvent =
  | 'call:incoming'
  | 'call:accepted'
  | 'call:rejected'
  | 'call:ended';

export type CallNotice = {
  userId: string;
  exceptSocketId?: string;
  event: CallLifecycleEvent;
  payload: {
    callId: string;
    conversationId: string;
    callerId?: string;
    acceptedBy?: string;
    rejectedBy?: string;
    endedBy?: string;
  };
};

export type CallMediaEvent = 'call:offer' | 'call:answer' | 'call:ice-candidate';

export type CallMediaDelivery = {
  socketId: string;
  event: CallMediaEvent;
  payload: {
    callId: string;
    sdp?: SessionDescription;
    candidate?: IceCandidate;
  };
};

export type InvitedCall = {
  callId: string;
  conversationId: string;
  callerId: string;
  recipientId: string;
};

@Injectable()
export class CallSignalingService {
  private readonly calls = new Map<string, CallSession>();
  private readonly callIdByUserId = new Map<string, string>();

  constructor(
    @InjectRepository(Conversation)
    private readonly conversationsRepository: Repository<Conversation>,

    @InjectRepository(Connection)
    private readonly connectionsRepository: Repository<Connection>,

    @InjectRepository(Message)
    private readonly messagesRepository: Repository<Message>,
  ) {}

  async invite(
    callerId: string,
    callerSocketId: string,
    conversationId: string,
  ): Promise<InvitedCall> {
    const conversation = await this.conversationForCaller(callerId, conversationId);
    const recipientId = otherParticipantId(conversation, callerId);

    await this.assertAcceptedConnection(callerId, recipientId);
    this.assertUsersAvailable(callerId, recipientId);

    const call: CallSession = {
      id: randomUUID(),
      conversationId: conversation.id,
      callerId,
      recipientId,
      state: 'ringing',
      callerSocketId,
      acceptedRecipientSocketId: null,
      startedAt: null,
    };

    this.remember(call);

    return {
      callId: call.id,
      conversationId: call.conversationId,
      callerId: call.callerId,
      recipientId: call.recipientId,
    };
  }

  incomingNotice(call: InvitedCall): CallNotice {
    return {
      userId: call.recipientId,
      event: 'call:incoming',
      payload: {
        callId: call.callId,
        conversationId: call.conversationId,
        callerId: call.callerId,
      },
    };
  }

  abandonUndelivered(callId: string) {
    const call = this.calls.get(callId);

    if (!call || call.state !== 'ringing') {
      return;
    }

    this.forget(call);
  }

  accept(userId: string, socketId: string, callId: string): CallNotice[] {
    const call = this.requireCall(callId);
    this.assertParticipant(call, userId);

    if (!isSameUser(call.recipientId, userId)) {
      throw new WsException('Only the recipient can accept this call');
    }

    if (call.state !== 'ringing' || call.acceptedRecipientSocketId) {
      throw new WsException('Call has already been accepted');
    }

    call.state = 'active';
    call.acceptedRecipientSocketId = socketId;
    call.startedAt = new Date();

    return [
      {
        userId: call.callerId,
        event: 'call:accepted',
        payload: {
          callId: call.id,
          conversationId: call.conversationId,
          acceptedBy: userId,
        },
      },
      {
        userId: call.recipientId,
        exceptSocketId: socketId,
        event: 'call:ended',
        payload: {
          callId: call.id,
          conversationId: call.conversationId,
          endedBy: userId,
        },
      },
    ];
  }

  async reject(
    userId: string,
    socketId: string,
    callId: string,
  ): Promise<CallNotice[]> {
    const call = this.requireCall(callId);
    this.assertParticipant(call, userId);

    if (!isSameUser(call.recipientId, userId)) {
      throw new WsException('Only the recipient can reject this call');
    }

    if (call.state !== 'ringing') {
      throw new WsException('Call has already been accepted');
    }

    await this.createCallHistory(call, 'rejected', null);

    this.forget(call);

    return [
      {
        userId: call.callerId,
        event: 'call:rejected',
        payload: {
          callId: call.id,
          conversationId: call.conversationId,
          rejectedBy: userId,
        },
      },
      {
        userId: call.recipientId,
        exceptSocketId: socketId,
        event: 'call:rejected',
        payload: {
          callId: call.id,
          conversationId: call.conversationId,
          rejectedBy: userId,
        },
      },
    ];
  }

  async end(
    userId: string,
    socketId: string,
    callId: string,
  ): Promise<CallNotice[]> {
    const call = this.requireCall(callId);
    this.assertParticipant(call, userId);

    const durationSeconds = this.callDurationSeconds(call);

    await this.createCallHistory(
      call,
      call.state === 'active' ? 'completed' : 'missed',
      durationSeconds,
    );

    this.forget(call);

    return this.endedNotices(call, userId, socketId);
  }

  offer(
    userId: string,
    socketId: string,
    callId: string,
    sdp: SessionDescription,
  ): CallMediaDelivery {
    const call = this.requireActiveCall(callId, userId);

    if (
      !isSameUser(call.callerId, userId) ||
      call.callerSocketId !== socketId ||
      sdp.type !== 'offer'
    ) {
      throw new WsException('Only the caller can send an offer');
    }

    if (!call.acceptedRecipientSocketId) {
      throw new WsException('Call is not active');
    }

    return {
      socketId: call.acceptedRecipientSocketId,
      event: 'call:offer',
      payload: { callId: call.id, sdp },
    };
  }

  answer(
    userId: string,
    socketId: string,
    callId: string,
    sdp: SessionDescription,
  ): CallMediaDelivery {
    const call = this.requireActiveCall(callId, userId);

    if (
      !isSameUser(call.recipientId, userId) ||
      call.acceptedRecipientSocketId !== socketId ||
      sdp.type !== 'answer'
    ) {
      throw new WsException('Only the recipient can send an answer');
    }

    return {
      socketId: call.callerSocketId,
      event: 'call:answer',
      payload: { callId: call.id, sdp },
    };
  }

  iceCandidate(
    userId: string,
    socketId: string,
    callId: string,
    candidate: IceCandidate,
  ): CallMediaDelivery {
    const call = this.requireActiveCall(callId, userId);
    const peerSocketId = this.peerMediaSocketId(call, userId, socketId);

    return {
      socketId: peerSocketId,
      event: 'call:ice-candidate',
      payload: { callId: call.id, candidate },
    };
  }

  async disconnectSocket(
    userId: string,
    socketId: string,
    userStillHasSockets: boolean,
  ): Promise<CallNotice[] | null> {
    const call = this.findCallForUser(userId);

    if (!call) {
      return null;
    }

    const callerSocketGone =
      isSameUser(call.callerId, userId) &&
      call.callerSocketId === socketId;

    const acceptedSocketGone =
      isSameUser(call.recipientId, userId) &&
      call.acceptedRecipientSocketId === socketId;

    const recipientUnavailable =
      isSameUser(call.recipientId, userId) &&
      call.state === 'ringing' &&
      !userStillHasSockets;

    if (!callerSocketGone && !acceptedSocketGone && !recipientUnavailable) {
      return null;
    }

    const status: CallHistoryStatus =
      call.state === 'active' ? 'completed' : 'missed';

    const durationSeconds = this.callDurationSeconds(call);

    await this.createCallHistory(
      call,
      status,
      durationSeconds,
    );

    this.forget(call);

    return this.endedNotices(call, userId);
  }

  private async createCallHistory(
    call: CallSession,
    status: CallHistoryStatus,
    durationSeconds: number | null,
  ): Promise<void> {
    const existing = await this.messagesRepository.findOne({
      where: {
        callId: call.id,
      },
      select: {
        id: true,
      },
    });

    if (existing) {
      return;
    }

    const message = this.messagesRepository.create({
      id: randomUUID(),
      conversationId: call.conversationId,
      senderId: call.callerId,
      content: '',
      messageType: 'call',
      callId: call.id,
      callStatus: status,
      callDurationSeconds: durationSeconds,
    });

    await this.messagesRepository.save(message);
  }

  private callDurationSeconds(call: CallSession): number | null {
    if (!call.startedAt) {
      return null;
    }

    const elapsedMilliseconds = Date.now() - call.startedAt.getTime();

    return Math.max(0, Math.floor(elapsedMilliseconds / 1000));
  }

  private endedNotices(
    call: CallSession,
    endedBy: string,
    exceptSocketId?: string,
  ): CallNotice[] {
    const payload = {
      callId: call.id,
      conversationId: call.conversationId,
      endedBy,
    };

    return [
      {
        userId: call.callerId,
        exceptSocketId,
        event: 'call:ended',
        payload,
      },
      {
        userId: call.recipientId,
        exceptSocketId,
        event: 'call:ended',
        payload,
      },
    ];
  }

  private async conversationForCaller(
    callerId: string,
    conversationId: string,
  ): Promise<Conversation> {
    if (!isUUID(conversationId)) {
      throw new WsException('Invalid conversation id');
    }

    const conversation = await this.conversationsRepository.findOne({
      where: { id: conversationId },
      select: {
        id: true,
        participantLowId: true,
        participantHighId: true,
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (!isParticipant(conversation, callerId)) {
      throw new ForbiddenException(
        'You are not a participant in this conversation',
      );
    }

    return conversation;
  }

  private async assertAcceptedConnection(
    callerId: string,
    recipientId: string,
  ) {
    const connection = await this.connectionsRepository.findOne({
      where: [
        {
          requesterId: callerId,
          recipientId,
          status: ConnectionStatus.ACCEPTED,
        },
        {
          requesterId: recipientId,
          recipientId: callerId,
          status: ConnectionStatus.ACCEPTED,
        },
      ],
      select: { id: true },
    });

    if (!connection) {
      throw new ForbiddenException(
        'An accepted connection is required to start a call',
      );
    }
  }

  private assertUsersAvailable(
    callerId: string,
    recipientId: string,
  ) {
    if (this.findCallForUser(callerId)) {
      throw new WsException('You are already in a call');
    }

    if (this.findCallForUser(recipientId)) {
      throw new WsException('The other person is already in a call');
    }
  }

  private requireCall(callId: string): CallSession {
    if (!isUUID(callId)) {
      throw new WsException('Invalid call id');
    }

    const call = this.calls.get(callId);

    if (!call) {
      throw new WsException('Call not found');
    }

    return call;
  }

  private requireActiveCall(
    callId: string,
    userId: string,
  ): CallSession {
    const call = this.requireCall(callId);
    this.assertParticipant(call, userId);

    if (
      call.state !== 'active' ||
      !call.acceptedRecipientSocketId
    ) {
      throw new WsException('Call is not active');
    }

    return call;
  }

  private assertParticipant(
    call: CallSession,
    userId: string,
  ) {
    if (
      !isSameUser(call.callerId, userId) &&
      !isSameUser(call.recipientId, userId)
    ) {
      throw new WsException(
        'You are not a participant in this call',
      );
    }
  }

  private peerMediaSocketId(
    call: CallSession,
    userId: string,
    socketId: string,
  ): string {
    if (
      isSameUser(call.callerId, userId) &&
      call.callerSocketId === socketId &&
      call.acceptedRecipientSocketId
    ) {
      return call.acceptedRecipientSocketId;
    }

    if (
      isSameUser(call.recipientId, userId) &&
      call.acceptedRecipientSocketId === socketId
    ) {
      return call.callerSocketId;
    }

    throw new WsException(
      'You cannot send signaling for this call',
    );
  }

  private findCallForUser(
    userId: string,
  ): CallSession | undefined {
    const callId = this.callIdByUserId.get(userKey(userId));

    if (!callId) {
      return undefined;
    }

    return this.calls.get(callId);
  }

  private remember(call: CallSession) {
    this.calls.set(call.id, call);
    this.callIdByUserId.set(
      userKey(call.callerId),
      call.id,
    );
    this.callIdByUserId.set(
      userKey(call.recipientId),
      call.id,
    );
  }

  private forget(call: CallSession) {
    this.calls.delete(call.id);
    this.callIdByUserId.delete(
      userKey(call.callerId),
    );
    this.callIdByUserId.delete(
      userKey(call.recipientId),
    );
  }
}

export function readSessionDescription(
  value: unknown,
  expectedType: 'offer' | 'answer',
): SessionDescription {
  if (!value || typeof value !== 'object') {
    throw new WsException('Invalid session description');
  }

  const description = value as {
    type?: unknown;
    sdp?: unknown;
  };

  if (
    description.type !== expectedType ||
    typeof description.sdp !== 'string'
  ) {
    throw new WsException('Invalid session description');
  }

  if (
    description.sdp.length === 0 ||
    description.sdp.length > MAX_SDP_LENGTH ||
    description.sdp.trim().length === 0
  ) {
    throw new WsException('Invalid session description');
  }

  return {
    type: expectedType,
    sdp: description.sdp,
  };
}

export function readIceCandidate(
  value: unknown,
): IceCandidate {
  if (!value || typeof value !== 'object') {
    throw new WsException('Invalid ICE candidate');
  }

  const candidate = value as {
    candidate?: unknown;
    sdpMid?: unknown;
    sdpMLineIndex?: unknown;
  };

  if (
    typeof candidate.candidate !== 'string' ||
    candidate.candidate.length > MAX_ICE_CANDIDATE_LENGTH
  ) {
    throw new WsException('Invalid ICE candidate');
  }

  const sdpMid = candidate.sdpMid ?? null;
  const sdpMLineIndex = candidate.sdpMLineIndex ?? null;

  if (
    sdpMid !== null &&
    (typeof sdpMid !== 'string' ||
      sdpMid.length > MAX_SDP_MID_LENGTH)
  ) {
    throw new WsException('Invalid ICE candidate');
  }

  if (
    sdpMLineIndex !== null &&
    (typeof sdpMLineIndex !== 'number' ||
      !Number.isInteger(sdpMLineIndex) ||
      sdpMLineIndex < 0)
  ) {
    throw new WsException('Invalid ICE candidate');
  }

  return {
    candidate: candidate.candidate,
    sdpMid,
    sdpMLineIndex,
  };
}

function otherParticipantId(
  conversation: Conversation,
  callerId: string,
): string {
  if (
    isSameUser(
      conversation.participantLowId,
      callerId,
    )
  ) {
    return conversation.participantHighId;
  }

  return conversation.participantLowId;
}

function isParticipant(
  conversation: Conversation,
  userId: string,
): boolean {
  return (
    isSameUser(
      conversation.participantLowId,
      userId,
    ) ||
    isSameUser(
      conversation.participantHighId,
      userId,
    )
  );
}

function isSameUser(
  left: string,
  right: string,
): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function userKey(userId: string): string {
  return userId.toLowerCase();
}
