// ============================================
// APPOINTMENT CONTROLLER - Book & Manage Appointments
// ============================================

const prisma = require('../prisma');
const asyncHandler = require('../utils/asyncHandler');
const { buildAvailabilityForDate, normalizeDateOnly, normalizeTimeOnly } = require('../utils/availabilityService');

// ============================================
// CREATE APPOINTMENT (Patient books)
// ============================================
exports.createAppointment = asyncHandler(async (req, res) => {
  const patientId = req.user.id;
  const { doctorId, date, time, mediaType } = req.body;
  const requestedTime = normalizeTimeOnly(time);

  if (!doctorId || !date || !time) {
    return res.status(400).json({ error: 'Please provide doctor, date and time' });
  }

  if (!requestedTime) {
    return res.status(400).json({ error: 'Invalid time format' });
  }

  const appointmentDate = normalizeDateOnly(date);
  if (!appointmentDate) {
    return res.status(400).json({ error: 'Invalid date format' });
  }

  const dayOfWeek = appointmentDate.getDay();
  const dayStart = new Date(appointmentDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const [doctor, doctorTimeSlots, doctorAppointments] = await Promise.all([
    prisma.user.findUnique({
      where: { id: doctorId },
      select: {
        id: true,
        userType: true,
        profile: { select: { isAvailable: true } }
      }
    }),
    prisma.timeSlot.findMany({
      where: {
        doctorId,
        OR: [
          { specificDate: { gte: dayStart, lt: dayEnd } },
          { specificDate: null, dayOfWeek }
        ]
      },
      orderBy: [
        { specificDate: 'asc' },
        { startTime: 'asc' }
      ]
    }),
    prisma.appointment.findMany({
      where: {
        doctorId,
        appointmentDate: { gte: dayStart, lt: dayEnd },
        status: { in: ['pending', 'confirmed', 'completed'] }
      },
      select: {
        appointmentDate: true,
        appointmentTime: true,
        status: true
      }
    })
  ]);

  if (!doctor || (doctor.userType !== 'psychologue' && doctor.userType !== 'counselor')) {
    return res.status(404).json({ error: 'Doctor not found' });
  }

  if (!doctor.profile?.isAvailable) {
    return res.status(400).json({ error: 'Doctor is not available' });
  }

  // ============================================
  // VIP vs NORMAL restrictions
  // ============================================
  const isVIPDoctor = await prisma.vIPSubscription.findFirst({
    where: { psychologueId: doctorId, isActive: true }
  });
  const isActiveVIP = isVIPDoctor && new Date(isVIPDoctor.endDate) > new Date();

  if (!isActiveVIP) {
    const allowedDays = [0, 1, 2, 3, 4];
    if (!allowedDays.includes(dayOfWeek)) {
      return res.status(400).json({
        error: 'Ce praticien ne consulte que du dimanche au jeudi'
      });
    }

    const startOfMonth = new Date(appointmentDate.getFullYear(), appointmentDate.getMonth(), 1);
    const endOfMonth = new Date(appointmentDate.getFullYear(), appointmentDate.getMonth() + 1, 0);

    const monthlyCount = await prisma.appointment.count({
      where: {
        doctorId,
        appointmentDate: { gte: startOfMonth, lte: endOfMonth },
        status: { in: ['pending', 'confirmed', 'completed'] }
      }
    });

    if (monthlyCount >= 4) {
      return res.status(400).json({
        error: 'Ce praticien a atteint sa limite de 4 consultations ce mois-ci'
      });
    }
  }

  // ============================================
  // Check slot exists and is not blocked
  // Use appointments list (not isBooked flag) to determine availability
  // isBooked flag can be stale; appointments are the source of truth
  // ============================================
  const slotExists = doctorTimeSlots.find(slot => normalizeTimeOnly(slot.startTime) === requestedTime);

  console.log('requestedTime:', requestedTime);
  console.log('doctorTimeSlots:', doctorTimeSlots.map(s => ({
    startTime: s.startTime,
    isBlocked: s.isBlocked,
    isBooked: s.isBooked,
    specificDate: s.specificDate,
    dayOfWeek: s.dayOfWeek
  })));
  console.log('doctorAppointments:', doctorAppointments.map(a => ({
    time: a.appointmentTime,
    status: a.status
  })));

  if (!slotExists) {
    return res.status(400).json({ error: 'Selected time is not available' });
  }

  if (slotExists.isBlocked) {
    return res.status(400).json({ error: 'Selected time is blocked by the doctor' });
  }

  // Check if there's already a confirmed/pending/completed appointment at this time
  const conflictingAppointment = doctorAppointments.find(apt =>
    normalizeTimeOnly(apt.appointmentTime) === requestedTime &&
    ['confirmed', 'completed'].includes(apt.status)
  );

  if (conflictingAppointment) {
    return res.status(400).json({ error: 'Selected time is already booked' });
  }

  const appointment = await prisma.appointment.create({
    data: {
      patientId,
      doctorId,
      appointmentDate,
      appointmentTime: requestedTime,
      mediaType: mediaType || 'video',
      status: 'pending'
    }
  });

  console.log('=== APPOINTMENT CREATED:', appointment.id);
  console.log('=== req.body.vipAnswers:', JSON.stringify(req.body.vipAnswers));

  if (req.body.vipAnswers && req.body.vipAnswers.length > 0) {
    console.log('=== SAVING VIP ANSWERS...');
    try {
      await prisma.vIPFormResponse.create({
        data: {
          appointmentId: appointment.id,
          patientId,
          doctorId,
          answers: JSON.stringify(req.body.vipAnswers)
        }
      });
      console.log('=== VIP ANSWERS SAVED OK');
    } catch (e) {
      console.log('=== VIP ANSWERS SAVE ERROR:', e.message);
    }
  } else {
    console.log('=== NO VIP ANSWERS IN REQUEST');
  }

  res.status(201).json({
    message: 'Appointment booked successfully!',
    appointment
  });

});

// ============================================
// GET MY APPOINTMENTS (Patient or Doctor)
// ============================================
exports.getMyAppointments = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const userType = req.user.userType || 'patient';
  const { status, view } = req.query;

  console.log('getMyAppointments - userId:', userId, 'userType:', userType);

  let whereClause = {};

  if (userType === 'patient') {
    whereClause.patientId = userId;
  } else if (userType === 'psychologue' || userType === 'counselor') {
    whereClause.doctorId = userId;
  }

  if (status) {
    whereClause.status = status;
  }

  if (view === 'summary') {
    let summarySelect = {
      id: true,
      appointmentDate: true,
      appointmentTime: true,
      mediaType: true,
      status: true
    };

    if (userType === 'patient') {
      summarySelect.doctor = { select: { fullname: true } };
    } else if (userType === 'psychologue' || userType === 'counselor') {
      summarySelect.patient = { select: { fullname: true } };
    }

    const appointments = await prisma.appointment.findMany({
      where: whereClause,
      select: summarySelect,
      orderBy: { appointmentDate: 'asc' }
    });

    const summary = appointments.map(apt => ({
      id: apt.id,
      appointmentDate: apt.appointmentDate,
      appointmentTime: apt.appointmentTime,
      mediaType: apt.mediaType,
      status: apt.status,
      doctorName: apt.doctor?.fullname,
      patientName: apt.patient?.fullname
    }));

    return res.json(summary);
  }

  const appointments = await prisma.appointment.findMany({
    where: whereClause,
    select: {
      id: true,
      appointmentDate: true,
      appointmentTime: true,
      mediaType: true,
      status: true,
      notes: true,
      createdAt: true,
      doctor: {
        select: {
          id: true,
          fullname: true,
          profile: { select: { specialite: true } }
        }
      },
      patient: {
        select: {
          id: true,
          fullname: true,
          profile: { select: { birthDate: true, gender: true } }
        }
      }
    },
    orderBy: { appointmentDate: 'asc' }
  });

  const formatted = appointments.map(apt => ({
    id: apt.id,
    appointmentDate: apt.appointmentDate,
    appointmentTime: apt.appointmentTime,
    mediaType: apt.mediaType,
    status: apt.status,
    notes: apt.notes,
    doctor: {
      id: apt.doctor.id,
      fullname: apt.doctor.fullname,
      specialite: apt.doctor.profile?.specialite
    },
    patient: {
      id: apt.patient.id,
      fullname: apt.patient.fullname,
      gender: apt.patient.profile?.gender
    },
    createdAt: apt.createdAt
  }));

  res.json(formatted);

});

// ============================================
// GET APPOINTMENT BY ID
// ============================================
exports.getAppointmentById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const appointment = await prisma.appointment.findUnique({
    where: { id },
    include: {
      doctor: { include: { profile: true } },
      patient: { include: { profile: true } }
    }
  });

  if (!appointment) {
    return res.status(404).json({ error: 'Appointment not found' });
  }

  if (appointment.patientId !== userId && appointment.doctorId !== userId) {
    return res.status(403).json({ error: 'Not authorized to view this appointment' });
  }

  res.json(appointment);

});

// ============================================
// UPDATE APPOINTMENT STATUS (Doctor confirms/completes/cancels)
// ============================================
exports.updateAppointmentStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body;
  const userId = req.user.id;

  const appointment = await prisma.appointment.findUnique({ where: { id } });

  if (!appointment) {
    return res.status(404).json({ error: 'Appointment not found' });
  }

  if (appointment.doctorId !== userId) {
    return res.status(403).json({ error: 'Only the doctor can update this appointment' });
  }

  const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const previousStatus = appointment.status;

  const updated = await prisma.appointment.update({
    where: { id },
    data: {
      status,
      ...(notes && { notes })
    }
  });

  if (status === 'completed' && previousStatus !== 'completed') {
    await prisma.profile.update({
      where: { userId: appointment.doctorId },
      data: { sessionsCompleted: { increment: 1 } }
    });
  }

  if (status !== 'completed' && previousStatus === 'completed') {
    await prisma.profile.update({
      where: { userId: appointment.doctorId },
      data: { sessionsCompleted: { decrement: 1 } }
    });
  }

  if (status === 'confirmed') {
    const appointmentDate = new Date(updated.appointmentDate);
    const dayOfWeek = appointmentDate.getDay();

    let slot = await prisma.timeSlot.findFirst({
      where: {
        doctorId: updated.doctorId,
        startTime: updated.appointmentTime,
        OR: [
          { specificDate: appointmentDate },
          { specificDate: null, dayOfWeek }
        ]
      }
    });

    if (slot && !slot.isBooked) {
      await prisma.timeSlot.update({
        where: { id: slot.id },
        data: { isBooked: true }
      });
    }
  }

  if (status === 'cancelled') {
    const dayOfWeek = new Date(appointment.appointmentDate).getDay();
    await prisma.timeSlot.updateMany({
      where: {
        doctorId: userId,
        dayOfWeek,
        startTime: appointment.appointmentTime,
        isBooked: true
      },
      data: { isBooked: false }
    });
  }

  const responseAppointment = await prisma.appointment.findUnique({
    where: { id },
    include: {
      patient: { select: { fullname: true } }
    }
  });

  res.json({
    message: `Appointment ${status} successfully`,
    appointment: responseAppointment
  });

});

// ============================================
// CANCEL APPOINTMENT (Patient can cancel)
// ============================================
exports.cancelAppointment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const appointment = await prisma.appointment.findUnique({ where: { id } });

  if (!appointment) {
    return res.status(404).json({ error: 'Appointment not found' });
  }

  if (appointment.patientId !== userId && appointment.doctorId !== userId) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const updated = await prisma.appointment.update({
    where: { id },
    data: { status: 'cancelled' }
  });

  const dayOfWeek = new Date(appointment.appointmentDate).getDay();
  await prisma.timeSlot.updateMany({
    where: {
      doctorId: appointment.doctorId,
      dayOfWeek,
      startTime: appointment.appointmentTime,
      isBooked: true
    },
    data: { isBooked: false }
  });

  res.json({ message: 'Appointment cancelled', appointment: updated });

});

// ============================================
// CREATE URGENT REQUEST (Patient)
// ============================================
exports.createUrgentRequest = asyncHandler(async (req, res) => {
  const patientId = req.user.id;
  const { doctorId, notes, appointmentTime } = req.body;

  console.log('Creating urgent request:', { patientId, doctorId, notes, appointmentTime });

  let selectedDoctorId = doctorId;
  if (!selectedDoctorId) {
    const availableDoctor = await prisma.user.findFirst({
      where: {
        userType: 'psychologue',
        profile: { isAvailable: true }
      }
    });

    console.log('Available doctor found:', availableDoctor?.id);

    if (availableDoctor) {
      selectedDoctorId = availableDoctor.id;
    } else {
      return res.status(400).json({ error: 'Aucun psychologue disponible pour le moment' });
    }
  }

  const now = new Date();
  const defaultTime = now.toTimeString().slice(0, 5);

  console.log('Creating with doctorId:', selectedDoctorId, 'time:', appointmentTime || defaultTime);

  const urgentRequest = await prisma.urgentRequest.create({
    data: {
      patientId,
      doctorId: selectedDoctorId,
      status: 'pending',
      notes: notes || 'Urgent VIP consultation request',
      amount: 1000,
      appointmentTime: appointmentTime || defaultTime,
      appointmentDate: new Date()
    },
    include: {
      patient: { select: { id: true, fullname: true } }
    }
  });

  console.log('Urgent request created:', urgentRequest.id);

  if (global.io) {
    global.io.to(`user:${selectedDoctorId}`).emit('urgentRequestCreated', {
      id: urgentRequest.id,
      patientId: urgentRequest.patientId,
      doctorId: urgentRequest.doctorId,
      patientName: urgentRequest.patient?.fullname,
      appointmentTime: urgentRequest.appointmentTime,
      status: urgentRequest.status,
      createdAt: urgentRequest.createdAt
    });
  }

  res.status(201).json({
    message: 'Urgent VIP request created successfully',
    urgentRequest
  });

});

// ============================================
// GET URGENT REQUESTS (Patient or Doctor)
// ============================================
exports.getUrgentRequests = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const userType = req.user.userType;
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  let whereClause = {};

  if (userType === 'patient') {
    whereClause.patientId = userId;
  } else if (userType === 'psychologue' || userType === 'counselor') {
    whereClause.doctorId = userId;
  }

  whereClause.createdAt = { gte: oneHourAgo };

  const urgentRequests = await prisma.urgentRequest.findMany({
    where: whereClause,
    include: {
      patient: { select: { id: true, fullname: true, email: true, profile: { select: { phone: true } } } },
      doctor: { select: { id: true, fullname: true, profile: { select: { specialite: true, phone: true } } } }
    },
    orderBy: { createdAt: 'desc' }
  });

  res.json(urgentRequests);

});

// ============================================
// ACCEPT URGENT REQUEST (Doctor)
// ============================================
exports.acceptUrgentRequest = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const doctorId = req.user.id;

  const existingCall = await prisma.urgentRequest.findFirst({
    where: {
      id,
      status: { in: ['in_call', 'rejected'] }
    }
  });

  if (existingCall) {
    return res.status(400).json({
      error: existingCall.status === 'in_call'
        ? 'Ce patient est déjà en consultation'
        : 'Cette demande a été annulée'
    });
  }

  const urgentRequest = await prisma.urgentRequest.update({
    where: { id },
    data: { status: 'in_call' },
    include: {
      patient: { select: { fullname: true, email: true, id: true } },
      doctor: { select: { fullname: true, id: true } }
    }
  });

  await prisma.urgentRequest.updateMany({
    where: {
      patientId: urgentRequest.patientId,
      status: 'pending',
      id: { not: id }
    },
    data: { status: 'rejected' }
  });

  if (global.io) {
    const cancelledRequests = await prisma.urgentRequest.findMany({
      where: {
        patientId: urgentRequest.patientId,
        status: 'rejected',
        id: { not: id }
      },
      select: { doctorId: true }
    });

    cancelledRequests.forEach(req => {
      if (req.doctorId) {
        global.io.to(`user:${req.doctorId}`).emit('urgentRequestCancelled', {
          patientId: urgentRequest.patientId
        });
      }
    });
  }

  const appointmentDate = urgentRequest.appointmentDate || new Date();
  const appointmentTime = urgentRequest.appointmentTime || new Date().toTimeString().slice(0, 5);

  const appointment = await prisma.appointment.create({
    data: {
      patientId: urgentRequest.patientId,
      doctorId: doctorId,
      appointmentDate: appointmentDate,
      appointmentTime: appointmentTime,
      mediaType: 'video',
      status: 'in_call',
      notes: 'URGENT VIP - ' + (urgentRequest.notes || 'Created from urgent request')
    }
  });

  if (global.io) {
    global.io.to(`user:${urgentRequest.patientId}`).emit('callAccepted', {
      urgentId: id,
      appointmentId: appointment.id,
      providerName: urgentRequest.doctor?.fullname || 'Provider',
      appointmentTime: appointmentTime,
      roomId: appointment.id
    });
  }

  res.json({
    message: 'Urgent VIP request accepted - starting video call',
    urgentRequest,
    appointment,
    startCall: true
  });
});

// ============================================
// REJECT URGENT REQUEST (Doctor)
// ============================================
exports.rejectUrgentRequest = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  const urgentRequest = await prisma.urgentRequest.update({
    where: { id },
    data: {
      status: 'rejected',
      notes: reason || 'Request rejected by doctor'
    },
    include: {
      patient: { select: { id: true, fullname: true } },
      doctor: { select: { fullname: true, id: true } }
    }
  });

  if (global.io) {
    global.io.to(`user:${urgentRequest.patientId}`).emit('callRejected', {
      urgentId: id,
      providerName: urgentRequest.doctor?.fullname || 'Provider',
      reason: reason || 'Request rejected by provider'
    });
  }

  res.json({
    message: 'Urgent request rejected',
    urgentRequest
  });

});

// ============================================
// GET URGENT ACCESS STATUS (Patient)
// ============================================
exports.getUrgentAccessStatus = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { urgentAccessStart: true, urgentAccessExpiry: true }
  });

  const now = new Date();
  const isActive = user.urgentAccessExpiry && new Date(user.urgentAccessExpiry) > now;
  const daysLeft = isActive ? Math.ceil((new Date(user.urgentAccessExpiry) - now) / (1000 * 60 * 60 * 24)) : 0;

  res.json({
    isActive: isActive || false,
    startDate: user.urgentAccessStart,
    expiryDate: user.urgentAccessExpiry,
    daysLeft: Math.max(0, daysLeft)
  });

});

// ============================================
// GET APPOINTMENT VIP ANSWERS
// ============================================
exports.getAppointmentAnswers = asyncHandler(async (req, res) => {
  const { id } = req.params;
  console.log('=== GET ANSWERS for appointment:', id);
  const response = await prisma.vIPFormResponse.findFirst({
    where: { appointmentId: id }
  });
  console.log('=== FOUND RESPONSE:', response ? 'YES' : 'NO');
  res.json({ answers: response ? JSON.parse(response.answers) : [] });
});

// ============================================
// ACTIVATE URGENT ACCESS (30 days)
// ============================================
exports.activateUrgentAccess = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const now = new Date();
  const expiryDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      urgentAccessStart: now,
      urgentAccessExpiry: expiryDate
    },
    select: { urgentAccessStart: true, urgentAccessExpiry: true }
  });

  res.json({
    success: true,
    message: 'URGENT access activated for 30 days',
    startDate: user.urgentAccessStart,
    expiryDate: user.urgentAccessExpiry
  });

});

// ============================================
// START CALL STATE (Doctor starts call)
// ============================================
exports.startCallState = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { patientId, appointmentId } = req.body;

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      currentCallId: appointmentId,
      currentCallPartnerId: patientId,
      currentCallStartedAt: new Date()
    },
    select: { id: true, fullname: true, currentCallId: true, currentCallPartnerId: true }
  });

  if (patientId) {
    await prisma.user.update({
      where: { id: patientId },
      data: {
        currentCallId: appointmentId,
        currentCallPartnerId: userId,
        currentCallStartedAt: new Date()
      }
    });
  }

  if (global.io && patientId) {
    global.io.to(`patient:${patientId}`).emit('session-started', {
      appointmentId: appointmentId,
      doctorId: userId,
      doctorName: user.fullname
    });
    console.log(`Emitted session-started to patient:${patientId}`);
  }

  res.json({ success: true, message: 'Call state started', doctorId: userId, patientId });

});

// ============================================
// END CALL STATE (Doctor or Patient ends call)
// ============================================
exports.endCallState = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const userType = req.user.userType;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { currentCallPartnerId: true, currentCallId: true }
  });

  const previousCallId = user?.currentCallId;
  const previousPartnerId = user?.currentCallPartnerId;

  await prisma.user.update({
    where: { id: userId },
    data: {
      currentCallId: null,
      currentCallPartnerId: null,
      currentCallStartedAt: null
    }
  });

  if (previousCallId) {
    try {
      await prisma.appointment.update({
        where: { id: previousCallId },
        data: { status: 'completed' }
      });
    } catch (e) {
      console.log('Could not mark appointment as completed:', e.message);
    }
  }

  if (userType === 'psychologue' || userType === 'counselor') {
    if (previousPartnerId) {
      await prisma.user.update({
        where: { id: previousPartnerId },
        data: {
          currentCallId: null,
          currentCallPartnerId: null,
          currentCallStartedAt: null
        }
      });

      if (global.io && previousPartnerId) {
        global.io.to(`patient:${previousPartnerId}`).emit('session-ended', {
          appointmentId: previousCallId
        });
        console.log(`Emitted session-ended to patient:${previousPartnerId}`);
      }
    }
  } else {
    if (global.io && previousPartnerId) {
      global.io.to(`doctor:${previousPartnerId}`).emit('session-ended', {
        appointmentId: previousCallId
      });
      console.log(`Emitted session-ended to doctor:${previousPartnerId}`);
    }
  }

  res.json({ success: true, message: 'Call state ended' });
});

// ============================================
// GET MY CALL STATUS (Patient or Doctor)
// ============================================
exports.getMyCallStatus = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      currentCallId: true,
      currentCallPartnerId: true,
      currentCallStartedAt: true
    }
  });

  if (!user?.currentCallId || !user?.currentCallPartnerId) {
    return res.json({ inCall: false });
  }

  const partner = await prisma.user.findUnique({
    where: { id: user.currentCallPartnerId },
    select: {
      id: true,
      fullname: true,
      profile: { select: { specialite: true } }
    }
  });

  if (!partner) {
    return res.json({ inCall: false });
  }

  res.json({
    inCall: true,
    appointmentId: user.currentCallId,
    doctorId: partner.id,
    doctorName: partner.fullname,
    doctorSpecialite: partner.profile?.specialite,
    startedAt: user.currentCallStartedAt
  });

});

// ============================================
// GET CALL STATUS (Patient checks if doctor is in call)
// ============================================
exports.getCallStatus = asyncHandler(async (req, res) => {
  const { doctorId } = req.params;
  const patientId = req.user.id;

  const doctor = await prisma.user.findUnique({
    where: { id: doctorId },
    select: {
      id: true,
      fullname: true,
      currentCallId: true,
      currentCallPartnerId: true,
      currentCallStartedAt: true,
      profile: { select: { specialite: true } }
    }
  });

  if (!doctor) {
    return res.json({ inCall: false });
  }

  const inCall = doctor.currentCallId && doctor.currentCallPartnerId === patientId;
  const isAvailable = !doctor.currentCallId;

  res.json({
    inCall: inCall,
    isAvailable: isAvailable,
    doctorId: doctor.id,
    doctorName: doctor.fullname,
    doctorSpecialite: doctor.profile?.specialite,
    appointmentId: doctor.currentCallId,
    startedAt: doctor.currentCallStartedAt
  });
});